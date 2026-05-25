const axios = require('axios');
const Car = require('../models/Car');
const Route = require('../models/Route');

const ORS_BASE_URL = 'https://api.openrouteservice.org';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickPositiveNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function trimText(value) {
  return String(value || '').trim();
}

function normalizeTripType(tripType = '') {
  const value = trimText(tripType).toLowerCase();
  if (value.includes('round')) return 'round-trip';
  if (value.includes('local')) return 'local-package';
  if (value.includes('airport')) return 'airport-transfer';
  if (value.includes('multi')) return 'multi-day-tour';
  return 'one-way';
}

function normalizeCoordinates(input) {
  if (!input) return null;

  if (Array.isArray(input) && input.length >= 2) {
    const longitude = toNumber(input[0], NaN);
    const latitude = toNumber(input[1], NaN);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) return [longitude, latitude];
  }

  if (typeof input === 'string') {
    const parts = input.split(',').map((part) => toNumber(part.trim(), NaN));
    if (parts.length >= 2 && parts.every(Number.isFinite)) return [parts[0], parts[1]];
  }

  if (typeof input === 'object') {
    const longitude = toNumber(input.longitude ?? input.lng ?? input.lon, NaN);
    const latitude = toNumber(input.latitude ?? input.lat, NaN);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) return [longitude, latitude];
  }

  return null;
}

function formatGeoPoint(feature, fallbackLabel = '') {
  if (!feature) return null;
  const coordinates = feature.geometry?.coordinates || feature.coordinates || null;
  return {
    label: feature.properties?.label || feature.properties?.name || fallbackLabel,
    coordinates: normalizeCoordinates(coordinates),
    raw: feature
  };
}

async function resolvePlaces(query, limit = 5) {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY || process.env.ORS_API_KEY || '';
  const text = trimText(query);
  if (!apiKey || !text) return [];

  const response = await axios.get(`${ORS_BASE_URL}/geocode/search`, {
    params: {
      text,
      size: limit,
      boundary_country: 'IN',
      layers: 'venue,address,locality,county,region'
    },
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json'
    },
    timeout: 12000
  });

  return (response.data?.features || []).map((feature) => formatGeoPoint(feature)).filter(Boolean);
}

async function resolveVehiclePricing({ car, vehicleId, selectedCar, settings }) {
  let resolvedCar = car || null;

  if (!resolvedCar && vehicleId) {
    resolvedCar = await Car.findById(vehicleId).lean();
  }

  if (!resolvedCar && selectedCar) {
    resolvedCar = await Car.findOne({ carName: new RegExp(`^${String(selectedCar).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
  }

  const pricingSettings = settings?.pricingSettings || {};
  const baseFare = pickPositiveNumber(resolvedCar?.baseFare, pricingSettings.baseFare, resolvedCar?.pricePerDay);
  const perKmRate = pickPositiveNumber(resolvedCar?.pricePerKm, pricingSettings.pricePerKm, pricingSettings.extraKmRate);
  const extraKmRate = pickPositiveNumber(resolvedCar?.extraKmRate, pricingSettings.extraKmRate, perKmRate);
  const includedKm = pickPositiveNumber(resolvedCar?.includedKm, pricingSettings.defaultIncludedKm, 80);
  const nightChargePercent = pickPositiveNumber(resolvedCar?.nightChargePercent, pricingSettings.nightChargePercent, 10);
  const driverAllowance = pickPositiveNumber(resolvedCar?.driverAllowance, pricingSettings.driverAllowance, 0);

  return {
    car: resolvedCar,
    baseFare,
    perKmRate,
    extraKmRate,
    includedKm,
    nightChargePercent,
    driverAllowance,
    gstPercent: pickPositiveNumber(settings?.pricingSettings?.gstPercent, settings?.billing?.taxPercent, 5),
    waitingChargePerHour: toNumber(pricingSettings.waitingChargePerHour, 0)
  };
}

function calculateNightCharge(subtotal, pickupDateTime, nightChargePercent) {
  const date = pickupDateTime ? new Date(pickupDateTime) : null;
  if (!date || Number.isNaN(date.getTime())) return 0;

  const hour = date.getHours();
  const isNight = hour >= 22 || hour < 6;
  if (!isNight) return 0;

  return Math.max(0, Math.round(subtotal * (toNumber(nightChargePercent, 10) / 100)));
}

function calculateGST(amount, gstPercent) {
  return Math.max(0, Math.round(toNumber(amount, 0) * (toNumber(gstPercent, 5) / 100)));
}

async function resolveRouteData({ pickup, drop }) {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY || process.env.ORS_API_KEY || '';
  const pickupCoordinates = normalizeCoordinates(pickup?.coordinates);
  const dropCoordinates = normalizeCoordinates(drop?.coordinates);

  if (!apiKey || !pickupCoordinates || !dropCoordinates) {
    return null;
  }

  const response = await axios.post(
    `${ORS_BASE_URL}/v2/directions/driving-car`,
    { coordinates: [pickupCoordinates, dropCoordinates] },
    {
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  const route = response.data?.routes?.[0] || {};
  return {
    distanceInKm: toNumber(route.summary?.distance, 0) / 1000,
    estimatedDuration: toNumber(route.summary?.duration, 0) / 60,
    geometry: route.geometry?.coordinates || [],
    raw: route
  };
}

async function fallbackRouteEstimate({ pickup, drop }) {
  const routes = await Route.find({}).lean();
  const pickupText = trimText(pickup?.address).toLowerCase();
  const dropText = trimText(drop?.address).toLowerCase();

  const matchingRoute = routes.find((route) => {
    const fromMatch = pickupText.includes(String(route.from || '').toLowerCase()) || String(route.from || '').toLowerCase().includes(pickupText);
    const toMatch = dropText.includes(String(route.to || '').toLowerCase()) || String(route.to || '').toLowerCase().includes(dropText);
    return fromMatch && toMatch;
  });

  if (matchingRoute) {
    const distanceMatch = String(matchingRoute.distance || '').match(/\d+(?:\.\d+)?/);
    const distanceInKm = distanceMatch ? Number(distanceMatch[0]) : 0;
    const durationMatch = String(matchingRoute.estimatedTime || '').match(/\d+(?:\.\d+)?/);
    const estimatedDuration = durationMatch ? Number(durationMatch[0]) * 60 : 0;
    return { distanceInKm, estimatedDuration, geometry: [], raw: matchingRoute };
  }

  return { distanceInKm: 0, estimatedDuration: 0, geometry: [], raw: null };
}

async function calculateFareQuote({
  pickup,
  drop,
  vehicle,
  vehicleId,
  selectedCar,
  tripPackage,
  tripType,
  passengers,
  pickupDateTime,
  waitingMinutes,
  tollCharges,
  settings
}) {
  const resolvedPickup = {
    address: trimText(pickup?.address),
    coordinates: normalizeCoordinates(pickup?.coordinates)
  };
  const resolvedDrop = {
    address: trimText(drop?.address),
    coordinates: normalizeCoordinates(drop?.coordinates)
  };

  const pricing = await resolveVehiclePricing({ car: vehicle, vehicleId, selectedCar, settings });
  let route = null;
  let source = 'openrouteservice';

  try {
    route = await resolveRouteData({ pickup: resolvedPickup, drop: resolvedDrop });
  } catch (error) {
    route = null;
  }

  if (!route) {
    route = await fallbackRouteEstimate({ pickup: resolvedPickup, drop: resolvedDrop });
    source = 'fallback-route';
  }

  const activeTripType = normalizeTripType(tripType || tripPackage?.packageName || 'one-way');
  const distanceInKm = toNumber(route.distanceInKm, 0);
  const durationMinutes = toNumber(route.estimatedDuration, 0);
  const tripDistance = activeTripType === 'round-trip' ? distanceInKm * 2 : distanceInKm;
  const localIncludedKm = activeTripType === 'local-package' ? Math.max(pricing.includedKm || 80, 80) : pricing.includedKm;
  const chargeableDistance = Math.max(0, tripDistance - localIncludedKm);
  const distanceFare = Math.max(0, Math.round(chargeableDistance * (pricing.extraKmRate || pricing.perKmRate || 0)));
  const waitingHours = Math.max(0, toNumber(waitingMinutes, 0) / 60);
  const waitingChargesAmount = Math.max(0, Math.round(waitingHours * pricing.waitingChargePerHour));
  const baseSubtotalBeforeNight = Math.max(0, pricing.baseFare + distanceFare + Math.max(0, toNumber(tollCharges, 0)) + pricing.driverAllowance + waitingChargesAmount);
  const nightCharges = calculateNightCharge(baseSubtotalBeforeNight, pickupDateTime, pricing.nightChargePercent);
  const subtotalAmount = Math.max(0, baseSubtotalBeforeNight + nightCharges);
  const gstAmount = calculateGST(subtotalAmount, pricing.gstPercent);
  const totalAmount = Math.max(0, subtotalAmount + gstAmount);

  const fareBreakdown = {
    tripType: activeTripType,
    baseFare: pricing.baseFare,
    perKmRate: pricing.perKmRate,
    extraKmRate: pricing.extraKmRate,
    includedKm: localIncludedKm,
    distanceInKm: Number(distanceInKm.toFixed(2)),
    estimatedDuration: Math.round(durationMinutes),
    tripDistance: Number(tripDistance.toFixed(2)),
    chargeableDistance: Number(chargeableDistance.toFixed(2)),
    distanceFare,
    tollCharges: Math.max(0, Math.round(toNumber(tollCharges, 0))),
    waitingCharges: waitingChargesAmount,
    nightCharges,
    driverAllowance: pricing.driverAllowance,
    gstPercent: pricing.gstPercent,
    gstAmount,
    subtotalAmount,
    totalAmount,
    currency: 'INR',
    passengers: passengers || '',
    source
  };

  return {
    source,
    pickup: resolvedPickup,
    drop: resolvedDrop,
    vehicle: pricing.car,
    routeGeometry: route.geometry,
    distanceInKm: fareBreakdown.distanceInKm,
    estimatedDuration: fareBreakdown.estimatedDuration,
    fareBreakdown,
    totalFare: totalAmount
  };
}

module.exports = {
  calculateFareQuote,
  calculateGST,
  calculateNightCharge,
  normalizeTripType,
  resolvePlaces
};