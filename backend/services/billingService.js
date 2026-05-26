const axios = require('axios');
const Car = require('../models/Car');
const Route = require('../models/Route');

const ORS_BASE_URL = 'https://api.openrouteservice.org';

function getOpenRouteServiceApiKey() {
  return process.env.OPENROUTESERVICE_API_KEY || process.env.ORS_API_KEY || '';
}

function debugBookingRoute(label, payload) {
  if (process.env.NODE_ENV === 'production') return;
  console.debug(`[booking-route] ${label}`, payload);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value) {
  return Math.max(0, Math.round(toNumber(value, 0)));
}

function clampMinimum(value, fallback = 0) {
  const parsed = toNumber(value, NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    const first = toNumber(input[0], NaN);
    const second = toNumber(input[1], NaN);
    if (Number.isFinite(first) && Number.isFinite(second)) {
      return [first, second];
    }
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

function estimateDurationMinutes(distanceInKm) {
  const kilometers = Math.max(0, toNumber(distanceInKm, 0));
  if (kilometers <= 0) return 0;
  return Math.max(1, Math.round((kilometers / 40) * 60));
}

function haversineDistanceKm(fromCoordinates, toCoordinates) {
  if (!fromCoordinates || !toCoordinates) return 0;

  const [fromLng, fromLat] = fromCoordinates;
  const [toLng, toLat] = toCoordinates;
  const earthRadiusKm = 6371;
  const deltaLat = ((toLat - fromLat) * Math.PI) / 180;
  const deltaLng = ((toLng - fromLng) * Math.PI) / 180;
  const lat1 = (fromLat * Math.PI) / 180;
  const lat2 = (toLat * Math.PI) / 180;

  const a = Math.sin(deltaLat / 2) ** 2 + Math.sin(deltaLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function formatGeoPoint(feature, fallbackLabel = '') {
  if (!feature) return null;
  return {
    label: feature.properties?.label || feature.properties?.name || fallbackLabel,
    coordinates: normalizeCoordinates(feature.geometry?.coordinates || feature.coordinates || null),
    raw: feature
  };
}

async function resolvePlaces(query, limit = 5) {
  const apiKey = getOpenRouteServiceApiKey();
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

  const suggestions = (response.data?.features || []).map((feature) => formatGeoPoint(feature)).filter(Boolean);
  debugBookingRoute('geocode-search', { query: text, count: suggestions.length });
  return suggestions;
}

async function geocodeAddress(address) {
  const results = await resolvePlaces(address, 1).catch(() => []);
  return results[0] || null;
}

async function reverseGeocodeCoordinates({ longitude, latitude }) {
  const apiKey = getOpenRouteServiceApiKey();
  const lng = toNumber(longitude, NaN);
  const lat = toNumber(latitude, NaN);

  if (!apiKey || !Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  const response = await axios.get(`${ORS_BASE_URL}/geocode/reverse`, {
    params: {
      'point.lon': lng,
      'point.lat': lat,
      size: 1
    },
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json'
    },
    timeout: 12000
  });

  const feature = response.data?.features?.[0] || null;
  const location = formatGeoPoint(feature);
  debugBookingRoute('geocode-reverse', { longitude: lng, latitude: lat, found: Boolean(location) });
  return location;
}

async function resolveVehiclePricing({ vehicle, vehicleId, selectedCar, settings }) {
  let resolvedVehicle = vehicle || null;

  if (!resolvedVehicle && vehicleId) {
    resolvedVehicle = await Car.findById(vehicleId).lean();
  }

  if (!resolvedVehicle && selectedCar) {
    resolvedVehicle = await Car.findOne({ carName: new RegExp(`^${String(selectedCar).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
  }

  const pricingSettings = settings?.pricingSettings || {};
  const billingSettings = settings?.billing || {};

  return {
    car: resolvedVehicle,
    baseFare: clampMinimum(resolvedVehicle?.baseFare, clampMinimum(pricingSettings.baseFare, clampMinimum(resolvedVehicle?.pricePerDay, 0))),
    pricePerKm: clampMinimum(resolvedVehicle?.pricePerKm, clampMinimum(pricingSettings.pricePerKm, 0)),
    extraKmRate: clampMinimum(resolvedVehicle?.extraKmRate, clampMinimum(pricingSettings.extraKmRate, clampMinimum(resolvedVehicle?.pricePerKm, 0))),
    includedKm: clampMinimum(resolvedVehicle?.includedKm, clampMinimum(pricingSettings.defaultIncludedKm, 0)),
    includedHours: clampMinimum(resolvedVehicle?.includedHours, clampMinimum(pricingSettings.defaultIncludedHours, 8)),
    extraHourRate: clampMinimum(resolvedVehicle?.extraHourRate, clampMinimum(pricingSettings.extraHourRate, 0)),
    nightChargePercent: clampMinimum(resolvedVehicle?.nightChargePercent, clampMinimum(pricingSettings.nightChargePercent, 10)),
    driverAllowance: clampMinimum(resolvedVehicle?.driverAllowance, clampMinimum(pricingSettings.driverAllowance, 0)),
    waitingChargePerHour: clampMinimum(pricingSettings.waitingChargePerHour, 0),
    freeWaitingMinutes: clampMinimum(pricingSettings.freeWaitingMinutes, 30),
    gstPercent: clampMinimum(pricingSettings.gstPercent, clampMinimum(billingSettings.taxPercent, 5)),
    tollCharges: clampMinimum(pricingSettings.tollCharges, clampMinimum(billingSettings.tollCharges, 0)),
    parkingCharges: clampMinimum(pricingSettings.parkingCharges, 0),
    permitCharges: clampMinimum(pricingSettings.permitCharges, 0),
    luggageCharges: clampMinimum(pricingSettings.luggageCharges, 0),
    hillAreaCharges: clampMinimum(pricingSettings.hillAreaCharges, 0),
    multiDayCharges: clampMinimum(pricingSettings.multiDayCharges, 0),
    statePermitCharges: clampMinimum(pricingSettings.statePermitCharges, 0),
    nightSurchargePercent: clampMinimum(pricingSettings.nightChargePercent, 10),
    perDayIncludedKm: clampMinimum(pricingSettings.defaultIncludedKm, 80),
    perDayIncludedHours: clampMinimum(pricingSettings.defaultIncludedHours, 8)
  };
}

async function resolveRouteEstimate({ pickup, drop }) {
  const apiKey = getOpenRouteServiceApiKey();
  const pickupCoordinates = normalizeCoordinates(pickup?.coordinates);
  const dropCoordinates = normalizeCoordinates(drop?.coordinates);
  let resolvedPickupCoordinates = pickupCoordinates;
  let resolvedDropCoordinates = dropCoordinates;

  if (!resolvedPickupCoordinates) {
    const geocodedPickup = await geocodeAddress(pickup?.address).catch(() => null);
    resolvedPickupCoordinates = geocodedPickup?.coordinates || null;
  }

  if (!resolvedDropCoordinates) {
    const geocodedDrop = await geocodeAddress(drop?.address).catch(() => null);
    resolvedDropCoordinates = geocodedDrop?.coordinates || null;
  }

  if (apiKey && resolvedPickupCoordinates && resolvedDropCoordinates) {
    try {
      const response = await axios.post(
        `${ORS_BASE_URL}/v2/directions/driving-car`,
        {
          coordinates: [resolvedPickupCoordinates, resolvedDropCoordinates],
          geometry_format: 'geojson',
          instructions: false
        },
        {
          headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const route = response.data?.routes?.[0] || null;
      if (!route) {
        throw new Error('OpenRouteService directions response did not include routes[0]');
      }

      const distanceKm = toNumber(route.summary?.distance, 0) / 1000;
      const durationMinutes = toNumber(route.summary?.duration, 0) / 60;
      const safeDistanceKm = distanceKm > 0 ? distanceKm : haversineDistanceKm(resolvedPickupCoordinates, resolvedDropCoordinates);
      const safeDurationMinutes = durationMinutes > 0 ? durationMinutes : estimateDurationMinutes(safeDistanceKm);
      const geometry = route.geometry?.coordinates || route.geometry || [];

      debugBookingRoute('directions-response', {
        pickupCoordinates: resolvedPickupCoordinates,
        dropCoordinates: resolvedDropCoordinates,
        distanceKm: safeDistanceKm,
        durationMinutes: safeDurationMinutes,
        hasGeometry: Array.isArray(geometry) ? geometry.length > 0 : Boolean(geometry)
      });

      return {
        distanceInKm: safeDistanceKm,
        estimatedDuration: safeDurationMinutes,
        geometry,
        source: 'openrouteservice',
        pickupCoordinates: resolvedPickupCoordinates,
        dropCoordinates: resolvedDropCoordinates,
        raw: route
      };
    } catch (error) {
      const fallbackDistance = haversineDistanceKm(resolvedPickupCoordinates, resolvedDropCoordinates);
      const fallbackDuration = estimateDurationMinutes(fallbackDistance);
      debugBookingRoute('directions-fallback', {
        pickupCoordinates: resolvedPickupCoordinates,
        dropCoordinates: resolvedDropCoordinates,
        error: error?.message || 'OpenRouteService directions lookup failed',
        fallbackDistance,
        fallbackDuration
      });
      return {
        distanceInKm: fallbackDistance,
        estimatedDuration: fallbackDuration,
        geometry: [],
        source: 'geodesic-fallback',
        pickupCoordinates: resolvedPickupCoordinates,
        dropCoordinates: resolvedDropCoordinates,
        raw: null,
        error: error?.message || 'OpenRouteService directions lookup failed'
      };
    }
  }

  const routes = await Route.find({}).lean();
  const pickupText = trimText(pickup?.address).toLowerCase();
  const dropText = trimText(drop?.address).toLowerCase();
  const matchingRoute = routes.find((route) => {
    const fromText = String(route.from || '').toLowerCase();
    const toText = String(route.to || '').toLowerCase();
    const fromMatch = pickupText.includes(fromText) || fromText.includes(pickupText);
    const toMatch = dropText.includes(toText) || toText.includes(dropText);
    return fromMatch && toMatch;
  });

  if (matchingRoute) {
    const distanceMatch = String(matchingRoute.distance || '').match(/\d+(?:\.\d+)?/);
    const durationMatch = String(matchingRoute.estimatedTime || '').match(/\d+(?:\.\d+)?/);
    const distanceInKm = distanceMatch ? Number(distanceMatch[0]) : 0;
    const estimatedDuration = durationMatch ? Number(durationMatch[0]) * 60 : estimateDurationMinutes(distanceInKm);
    return {
      distanceInKm,
      estimatedDuration,
      geometry: [],
      source: 'route-table',
      pickupCoordinates: resolvedPickupCoordinates,
      dropCoordinates: resolvedDropCoordinates,
      raw: matchingRoute
    };
  }

  if (resolvedPickupCoordinates && resolvedDropCoordinates) {
    const distanceInKm = haversineDistanceKm(resolvedPickupCoordinates, resolvedDropCoordinates);
    return {
      distanceInKm,
      estimatedDuration: estimateDurationMinutes(distanceInKm),
      geometry: [],
      source: 'geodesic-fallback',
      pickupCoordinates: resolvedPickupCoordinates,
      dropCoordinates: resolvedDropCoordinates,
      raw: null
    };
  }

  return {
    distanceInKm: 0,
    estimatedDuration: 0,
    geometry: [],
    source: 'manual-fallback',
    pickupCoordinates: resolvedPickupCoordinates,
    dropCoordinates: resolvedDropCoordinates,
    raw: null
  };
}

function calculateDistanceFare({ tripType, distanceInKm, durationMinutes, pricePerKm, extraKmRate, includedKm, includedHours, tripPackage, roundTripMultiplier = 1 }) {
  const activeTripType = normalizeTripType(tripType || tripPackage?.packageName || 'one-way');
  const tripDistance = Math.max(0, toNumber(distanceInKm, 0) * Math.max(1, toNumber(roundTripMultiplier, 1)));
  const tripDuration = Math.max(0, toNumber(durationMinutes, 0) * Math.max(1, toNumber(roundTripMultiplier, 1)));
  const ratePerKm = clampMinimum(pricePerKm, clampMinimum(extraKmRate, 0));
  const rateForExtraKm = clampMinimum(extraKmRate, ratePerKm);
  const packageBaseFare = clampMinimum(tripPackage?.price, 0);
  const packageIncludedKm = clampMinimum(tripPackage?.includedKm, includedKm);
  const packageIncludedHours = clampMinimum(tripPackage?.includedHours, includedHours);
  const packageExtraHourRate = clampMinimum(tripPackage?.extraHourRate, 0);

  if (activeTripType === 'local-package') {
    const billableKm = Math.max(0, tripDistance - packageIncludedKm);
    const billableHours = Math.max(0, tripDuration / 60 - packageIncludedHours);
    const distanceFare = roundCurrency(billableKm * rateForExtraKm);
    const extraHourCharge = roundCurrency(billableHours * packageExtraHourRate);

    return {
      tripType: activeTripType,
      tripDistance: Number(tripDistance.toFixed(2)),
      billableDistance: Number(billableKm.toFixed(2)),
      includedKm: packageIncludedKm,
      includedHours: packageIncludedHours,
      distanceFare,
      extraHourCharge,
      packageBaseFare
    };
  }

  const distanceFare = roundCurrency(tripDistance * ratePerKm);

  return {
    tripType: activeTripType,
    tripDistance: Number(tripDistance.toFixed(2)),
    billableDistance: Number(tripDistance.toFixed(2)),
    includedKm: clampMinimum(includedKm, 0),
    includedHours: clampMinimum(includedHours, 0),
    distanceFare,
    extraHourCharge: 0,
    packageBaseFare
  };
}

function calculateTollCharges({ tollCharges = 0, adminAdjustment = 0, routeTollCharges = 0 } = {}) {
  return roundCurrency(toNumber(tollCharges, 0) + toNumber(adminAdjustment, 0) + toNumber(routeTollCharges, 0));
}

function calculateWaitingCharges({ waitingMinutes = 0, freeWaitingMinutes = 30, waitingChargePerHour = 0 }) {
  const waitedMinutes = Math.max(0, toNumber(waitingMinutes, 0));
  const freeMinutes = Math.max(0, toNumber(freeWaitingMinutes, 0));
  const chargeableMinutes = Math.max(0, waitedMinutes - freeMinutes);
  if (chargeableMinutes <= 0 || toNumber(waitingChargePerHour, 0) <= 0) return 0;

  return roundCurrency(Math.ceil(chargeableMinutes / 60) * toNumber(waitingChargePerHour, 0));
}

function calculateNightCharge(baseAmount, pickupDateTime, nightChargePercent) {
  const date = pickupDateTime ? new Date(pickupDateTime) : null;
  if (!date || Number.isNaN(date.getTime())) return 0;

  const hour = date.getHours();
  const isNight = hour >= 22 || hour < 6;
  if (!isNight) return 0;

  return roundCurrency(toNumber(baseAmount, 0) * (toNumber(nightChargePercent, 10) / 100));
}

function calculateGST(amount, gstPercent) {
  return roundCurrency(toNumber(amount, 0) * (toNumber(gstPercent, 5) / 100));
}

function calculateRoundTripFare(breakdown) {
  const tripDistance = Math.max(0, toNumber(breakdown?.tripDistance ?? breakdown?.distanceInKm, 0));
  const roundTripDistance = roundCurrency(tripDistance * 2);
  return {
    ...breakdown,
    roundTripDistance,
    tripDistance: roundTripDistance
  };
}

function buildBillingLineItems(breakdown = {}) {
  const rows = [];

  if (breakdown.packageBaseFare > 0) {
    rows.push({
      description: 'Package / Base Fare',
      quantity: 1,
      unitPrice: breakdown.packageBaseFare,
      tax: 0,
      amount: breakdown.packageBaseFare
    });
  } else if (breakdown.baseFare > 0) {
    rows.push({
      description: 'Base Fare',
      quantity: 1,
      unitPrice: breakdown.baseFare,
      tax: 0,
      amount: breakdown.baseFare
    });
  }

  rows.push({
    description: breakdown.tripType === 'local-package' ? 'Extra Distance Charge' : 'Distance Fare',
    quantity: Number(breakdown.billableDistance || breakdown.tripDistance || 0) > 0 ? 1 : 0,
    unitPrice: breakdown.billableDistance || breakdown.tripDistance || 0,
    tax: 0,
    amount: breakdown.distanceFare || 0
  });

  if (breakdown.extraHourCharge > 0) {
    rows.push({
      description: 'Extra Hour Charge',
      quantity: 1,
      unitPrice: breakdown.extraHourCharge,
      tax: 0,
      amount: breakdown.extraHourCharge
    });
  }

  if (breakdown.tollCharges > 0) {
    rows.push({
      description: 'Toll Charges',
      quantity: 1,
      unitPrice: breakdown.tollCharges,
      tax: 0,
      amount: breakdown.tollCharges
    });
  }

  if (breakdown.driverAllowance > 0) {
    rows.push({
      description: 'Driver Allowance',
      quantity: Math.max(1, toNumber(breakdown.driverAllowanceDays, 1)),
      unitPrice: breakdown.driverAllowancePerDay || breakdown.driverAllowance,
      tax: 0,
      amount: breakdown.driverAllowance
    });
  }

  if (breakdown.waitingCharges > 0) {
    rows.push({
      description: 'Waiting Charges',
      quantity: 1,
      unitPrice: breakdown.waitingCharges,
      tax: 0,
      amount: breakdown.waitingCharges
    });
  }

  if (breakdown.nightCharges > 0) {
    rows.push({
      description: 'Night Charges',
      quantity: 1,
      unitPrice: breakdown.nightCharges,
      tax: 0,
      amount: breakdown.nightCharges
    });
  }

  if (breakdown.extraTravelCharges > 0) {
    rows.push({
      description: 'Extra Travel Charges',
      quantity: 1,
      unitPrice: breakdown.extraTravelCharges,
      tax: 0,
      amount: breakdown.extraTravelCharges
    });
  }

  rows.push({
    description: `GST (${breakdown.gstPercent || 0}%)`,
    quantity: 1,
    unitPrice: breakdown.subtotalAmount || 0,
    tax: breakdown.gstAmount || 0,
    amount: breakdown.gstAmount || 0,
    isTaxRow: true
  });

  return rows;
}

function normalizeAdditionalCharges(input) {
  if (!input) {
    return {
      total: 0,
      breakdown: {}
    };
  }

  if (typeof input === 'number' || typeof input === 'string') {
    return {
      total: roundCurrency(input),
      breakdown: { manualAdjustment: roundCurrency(input) }
    };
  }

  const breakdown = {
    parkingCharges: roundCurrency(input.parkingCharges || input.parking || 0),
    permitCharges: roundCurrency(input.permitCharges || input.statePermitCharges || 0),
    luggageCharges: roundCurrency(input.luggageCharges || input.extraLuggageCharges || 0),
    hillAreaCharges: roundCurrency(input.hillAreaCharges || 0),
    multiDayCharges: roundCurrency(input.multiDayCharges || 0),
    manualAdjustment: toNumber(input.manualAdjustment || input.otherCharges || 0, 0)
  };

  const total = roundCurrency(
    breakdown.parkingCharges +
      breakdown.permitCharges +
      breakdown.luggageCharges +
      breakdown.hillAreaCharges +
      breakdown.multiDayCharges +
      breakdown.manualAdjustment
  );

  return {
    total,
    breakdown
  };
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
  extraCharges,
  route,
  tripDays,
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

  const pricing = await resolveVehiclePricing({ vehicle, vehicleId, selectedCar, settings });
  const activeTripType = normalizeTripType(tripType || tripPackage?.packageName || 'one-way');
  const roundTripMultiplier = activeTripType === 'round-trip' ? 2 : 1;

  let routeEstimate = null;
  let routeSource = 'manual-fallback';

  if (route?.distance || route?.distanceInKm || route?.estimatedTime) {
    const routeDistance = toNumber(route.distanceInKm, NaN) || (() => {
      const match = String(route.distance || '').match(/\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : 0;
    })();
    const routeDuration = toNumber(route.estimatedDuration, NaN) || (() => {
      const match = String(route.estimatedTime || '').match(/\d+(?:\.\d+)?/);
      return match ? Number(match[0]) * 60 : 0;
    })();
    routeEstimate = {
      distanceInKm: routeDistance,
      estimatedDuration: routeDuration,
      geometry: route.geometry || [],
      source: 'route-provided',
      pickupCoordinates: resolvedPickup.coordinates,
      dropCoordinates: resolvedDrop.coordinates,
      raw: route
    };
    routeSource = 'route-provided';
  } else {
    routeEstimate = await resolveRouteEstimate({ pickup: resolvedPickup, drop: resolvedDrop });
    routeSource = routeEstimate.source;
  }

  const additionalChargeBundle = normalizeAdditionalCharges(extraCharges);
  const tripDistance = Math.max(0, toNumber(routeEstimate.distanceInKm, 0) * roundTripMultiplier);
  const durationMinutes = Math.max(0, toNumber(routeEstimate.estimatedDuration, 0) * roundTripMultiplier);
  const localIncludedKm = activeTripType === 'local-package' ? Math.max(pricing.perDayIncludedKm, toNumber(tripPackage?.includedKm, 0) || 80) : pricing.includedKm;
  const localIncludedHours = activeTripType === 'local-package' ? Math.max(pricing.perDayIncludedHours, toNumber(tripPackage?.includedHours, 0) || 8) : pricing.includedHours;
  const distanceQuote = calculateDistanceFare({
    tripType: activeTripType,
    distanceInKm: tripDistance,
    durationMinutes,
    pricePerKm: pricing.pricePerKm,
    extraKmRate: pricing.extraKmRate,
    includedKm: localIncludedKm,
    includedHours: localIncludedHours,
    tripPackage,
    roundTripMultiplier
  });

  const distanceFare = roundCurrency(distanceQuote.distanceFare);
  const packageBaseFare = roundCurrency(distanceQuote.packageBaseFare);
  const baseFare = activeTripType === 'local-package' || activeTripType === 'airport-transfer' ? packageBaseFare || pricing.baseFare : pricing.baseFare;
  const tripDaysCount = Math.max(1, toNumber(tripDays, 0) || (activeTripType === 'multi-day-tour' ? 2 : activeTripType === 'round-trip' ? 2 : 1));
  const isLongDistance = activeTripType !== 'local-package' && activeTripType !== 'airport-transfer';
  const driverAllowance = isLongDistance ? roundCurrency(pricing.driverAllowance * (activeTripType === 'multi-day-tour' ? tripDaysCount : activeTripType === 'round-trip' ? 2 : 1)) : 0;
  const tollChargesAmount = calculateTollCharges({ tollCharges, adminAdjustment: additionalChargeBundle.breakdown.manualAdjustment, routeTollCharges: pricing.tollCharges });
  const waitingChargesAmount = calculateWaitingCharges({
    waitingMinutes,
    freeWaitingMinutes: pricing.freeWaitingMinutes,
    waitingChargePerHour: pricing.waitingChargePerHour
  });
  const extraTravelCharges = roundCurrency(
    additionalChargeBundle.total +
      pricing.parkingCharges +
      pricing.permitCharges +
      pricing.luggageCharges +
      pricing.hillAreaCharges +
      pricing.multiDayCharges +
      pricing.statePermitCharges
  );
  const nightChargesBase = baseFare + distanceFare + tollChargesAmount + driverAllowance + waitingChargesAmount + extraTravelCharges;
  const nightChargesAmount = calculateNightCharge(nightChargesBase, pickupDateTime, pricing.nightChargePercent);
  const subtotalAmount = roundCurrency(baseFare + distanceFare + tollChargesAmount + driverAllowance + waitingChargesAmount + nightChargesAmount + extraTravelCharges);
  const gstAmount = calculateGST(subtotalAmount, pricing.gstPercent);
  const totalAmount = roundCurrency(subtotalAmount + gstAmount);
  const cgstAmount = roundCurrency(gstAmount / 2);
  const sgstAmount = roundCurrency(gstAmount - cgstAmount);
  const lineItems = buildBillingLineItems({
    tripType: activeTripType,
    packageBaseFare,
    baseFare,
    tripDistance,
    billableDistance: distanceQuote.billableDistance,
    distanceFare,
    extraHourCharge: roundCurrency(distanceQuote.extraHourCharge),
    tollCharges: tollChargesAmount,
    driverAllowance,
    driverAllowanceDays: activeTripType === 'multi-day-tour' ? tripDaysCount : activeTripType === 'round-trip' ? 2 : 1,
    waitingCharges: waitingChargesAmount,
    nightCharges: nightChargesAmount,
    extraTravelCharges,
    subtotalAmount,
    gstPercent: pricing.gstPercent,
    gstAmount
  });

  const fareBreakdown = {
    tripType: activeTripType,
    source: routeSource,
    baseFare,
    packageBaseFare,
    pricePerKm: pricing.pricePerKm,
    extraKmRate: pricing.extraKmRate,
    includedKm: localIncludedKm,
    includedHours: localIncludedHours,
    distanceInKm: Number(toNumber(routeEstimate.distanceInKm, 0).toFixed(2)),
    estimatedDuration: Math.round(toNumber(routeEstimate.estimatedDuration, 0)),
    tripDistance: Number(tripDistance.toFixed(2)),
    billableDistance: Number(toNumber(distanceQuote.billableDistance, tripDistance).toFixed(2)),
    distanceFare,
    extraHourCharge: roundCurrency(distanceQuote.extraHourCharge),
    tollCharges: tollChargesAmount,
    waitingCharges: waitingChargesAmount,
    nightCharges: nightChargesAmount,
    driverAllowance,
    extraTravelCharges,
    parkingCharges: pricing.parkingCharges,
    permitCharges: pricing.permitCharges,
    luggageCharges: pricing.luggageCharges,
    hillAreaCharges: pricing.hillAreaCharges,
    multiDayCharges: pricing.multiDayCharges,
    statePermitCharges: pricing.statePermitCharges,
    waitingMinutes: Math.max(0, toNumber(waitingMinutes, 0)),
    freeWaitingMinutes: pricing.freeWaitingMinutes,
    waitingChargePerHour: pricing.waitingChargePerHour,
    nightChargePercent: pricing.nightChargePercent,
    driverAllowanceDays: activeTripType === 'multi-day-tour' ? tripDaysCount : activeTripType === 'round-trip' ? 2 : 1,
    subtotalAmount,
    subtotal: subtotalAmount,
    gstPercent: pricing.gstPercent,
    gstAmount,
    cgstAmount,
    sgstAmount,
    totalAmount,
    totalFare: totalAmount,
    currency: 'INR',
    passengers: passengers || '',
    lineItems
  };

  return {
    source: routeSource,
    pickup: {
      ...resolvedPickup,
      coordinates: routeEstimate.pickupCoordinates || resolvedPickup.coordinates
    },
    drop: {
      ...resolvedDrop,
      coordinates: routeEstimate.dropCoordinates || resolvedDrop.coordinates
    },
    vehicle: pricing.car,
    routeGeometry: routeEstimate.geometry || [],
    distanceInKm: fareBreakdown.distanceInKm,
    estimatedDuration: fareBreakdown.estimatedDuration,
    fareBreakdown,
    lineItems,
    totalFare: totalAmount
  };
}

module.exports = {
  buildBillingLineItems,
  calculateDistanceFare,
  calculateFareQuote,
  calculateGST,
  calculateNightCharge,
  calculateRoundTripFare,
  calculateTollCharges,
  calculateWaitingCharges,
  geocodeAddress,
  haversineDistanceKm,
  normalizeCoordinates,
  normalizeTripType,
  resolvePlaces,
  resolveRouteEstimate,
  resolveVehiclePricing,
  reverseGeocodeCoordinates
};