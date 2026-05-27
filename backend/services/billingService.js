const axios = require('axios');
const Car = require('../models/Car');
const Route = require('../models/Route');
const { roundCurrency, toNumber, validateBillingBreakdown } = require('../utils/billingMath');

const ORS_BASE_URL = 'https://api.openrouteservice.org';

function getOpenRouteServiceApiKey() {
  return process.env.OPENROUTESERVICE_API_KEY || process.env.ORS_API_KEY || '';
}

function debugBookingRoute(label, payload) {
  if (process.env.NODE_ENV === 'production') return;
  console.debug(`[booking-route] ${label}`, payload);
}

function clampMinimum(value, fallback = 0) {
  const parsed = toNumber(value, NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimText(value) {
  return String(value || '').trim();
}

function formatRate(value) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.max(0, toNumber(value, 0)));
}

function formatDuration(minutes) {
  const totalMinutes = Math.max(0, Math.round(toNumber(minutes, 0)));
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (!hours) {
    return `${remainingMinutes} min`;
  }

  return `${hours} hr ${remainingMinutes} min`;
}

function normalizeTripType(tripType = '') {
  const value = trimText(tripType).toLowerCase();
  if (value.includes('round')) return 'round-trip';
  if (value.includes('half')) return 'half-day-package';
  if (value.includes('local')) return 'local-package';
  if (value.includes('airport')) return 'airport-transfer';
  if (value.includes('outstation')) return 'outstation-package';
  if (value.includes('multi')) return 'multi-day-tour';
  if (value.includes('wedding') || value.includes('vip')) return 'wedding-vip-event';
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

function buildLocationLabel(properties = {}, fallbackLabel = '') {
  const primaryLabel = trimText(properties.label);
  if (primaryLabel) {
    return primaryLabel;
  }

  const parts = [
    properties.name,
    properties.locality,
    properties.district,
    properties.county,
    properties.region,
    properties.state,
    properties.country
  ]
    .map((part) => trimText(part))
    .filter(Boolean);

  if (parts.length) {
    return Array.from(new Set(parts)).join(', ');
  }

  return trimText(fallbackLabel);
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
  const label = buildLocationLabel(feature.properties || {}, fallbackLabel);
  return {
    label,
    address: label,
    displayName: label,
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

  // Prefer places within India when configured for IN boundary searches. OpenRouteService
  // can still return global matches for ambiguous queries; filter by country when possible
  const indiaMatches = suggestions.filter((s) => {
    const props = s.raw?.properties || {};
    const country = String(props.country || props.country_a || '').toLowerCase();
    const label = String(s.label || '').toLowerCase();
    return country === 'india' || country === 'ind' || label.includes(', india');
  });

  // If we found any India-specific matches, return those. Otherwise return full list
  // (keeps behavior permissive if no India matches exist).
  return indiaMatches.length ? indiaMatches : suggestions;
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
    localPackagePrice: clampMinimum(pricingSettings.localPackagePrice, clampMinimum(pricingSettings.baseFare, clampMinimum(resolvedVehicle?.baseFare, clampMinimum(resolvedVehicle?.pricePerDay, 6500)))),
    halfDayPrice: clampMinimum(pricingSettings.halfDayPrice, 3500),
    airportTransferMinCharge: clampMinimum(pricingSettings.airportTransferMinCharge, 2500),
    airportTransferMaxCharge: clampMinimum(pricingSettings.airportTransferMaxCharge, 3500),
    outstationMinCharge: clampMinimum(pricingSettings.outstationMinCharge, 0),
    outstationMaxCharge: clampMinimum(pricingSettings.outstationMaxCharge, 10500),
    weddingVipCharge: clampMinimum(pricingSettings.weddingVipCharge, 12000),
    baseFare: clampMinimum(resolvedVehicle?.baseFare, clampMinimum(pricingSettings.baseFare, clampMinimum(resolvedVehicle?.pricePerDay, 6500))),
    pricePerKm: clampMinimum(resolvedVehicle?.pricePerKm, clampMinimum(pricingSettings.pricePerKm, clampMinimum(pricingSettings.extraKmRate, 28))),
    extraKmRate: clampMinimum(resolvedVehicle?.extraKmRate, clampMinimum(pricingSettings.extraKmCharge, clampMinimum(pricingSettings.extraKmRate, clampMinimum(resolvedVehicle?.pricePerKm, 28)))),
    includedKm: clampMinimum(resolvedVehicle?.includedKm, clampMinimum(pricingSettings.defaultIncludedKm, 80)),
    includedHours: clampMinimum(resolvedVehicle?.includedHours, clampMinimum(pricingSettings.defaultIncludedHours, 8)),
    extraHourRate: clampMinimum(resolvedVehicle?.extraHourRate, clampMinimum(pricingSettings.extraHourCharge, 500)),
    nightChargePercent: clampMinimum(resolvedVehicle?.nightChargePercent, clampMinimum(pricingSettings.nightChargePercent, 10)),
    nightChargeFixed: clampMinimum(pricingSettings.nightChargeFixed, 0),
    driverAllowance: clampMinimum(resolvedVehicle?.driverAllowance, clampMinimum(pricingSettings.driverAllowance, 0)),
    driverAllowancePerDay: clampMinimum(resolvedVehicle?.driverAllowancePerDay, clampMinimum(pricingSettings.driverAllowancePerDay, clampMinimum(pricingSettings.driverAllowance, 0))),
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
    minimumFare: clampMinimum(pricingSettings.minimumFare, 0),
    surgeMultiplier: clampMinimum(pricingSettings.surgeMultiplier, 1),
    perDayIncludedKm: clampMinimum(pricingSettings.defaultIncludedKm, 80),
    perDayIncludedHours: clampMinimum(pricingSettings.defaultIncludedHours, 8)
  };
}

function resolvePackageProfile({ tripType, tripPackage, routeEstimate, pricing }) {
  const packageName = trimText(tripPackage?.packageName || '').toLowerCase();
  const activeTripType = normalizeTripType(tripType || tripPackage?.packageName || 'one-way');
  const routePrice = routeEstimate?.raw?.price ? roundCurrency(toNumber(routeEstimate.raw.price, 0)) : 0;
  const roundTripMultiplier = activeTripType === 'round-trip' ? 2 : 1;
  const flatRouteFare = routePrice > 0 ? roundCurrency(routePrice * roundTripMultiplier) : 0;

  if (flatRouteFare > 0 && ['one-way', 'round-trip'].includes(activeTripType)) {
    return {
      activeTripType,
      packageLabel: 'Route Fare',
      packageBaseFare: flatRouteFare,
      includedKm: 0,
      includedHours: 0,
      extraKmRate: pricing.extraKmRate,
      extraHourRate: pricing.extraHourRate,
      billableDistance: 0,
      distanceFare: 0,
      extraHourCharge: 0
    };
  }

  if (activeTripType === 'half-day-package' || packageName.includes('half')) {
    return {
      activeTripType: 'half-day-package',
      packageLabel: 'Half Day Package',
      packageBaseFare: roundCurrency(tripPackage?.price || pricing.halfDayPrice),
      includedKm: 40,
      includedHours: 4,
      extraKmRate: pricing.extraKmRate,
      extraHourRate: pricing.extraHourRate,
      billableDistance: 0,
      distanceFare: 0,
      extraHourCharge: 0
    };
  }

  if (activeTripType === 'local-package' || packageName.includes('local')) {
    return {
      activeTripType: 'local-package',
      packageLabel: 'Local Package',
      packageBaseFare: roundCurrency(tripPackage?.price || pricing.localPackagePrice),
      includedKm: 80,
      includedHours: 8,
      extraKmRate: pricing.extraKmRate,
      extraHourRate: pricing.extraHourRate,
      billableDistance: 0,
      distanceFare: 0,
      extraHourCharge: 0
    };
  }

  if (activeTripType === 'airport-transfer' || packageName.includes('airport')) {
    return {
      activeTripType: 'airport-transfer',
      packageLabel: 'Airport Pickup / Drop',
      packageBaseFare: roundCurrency(tripPackage?.price || pricing.airportTransferMinCharge),
      includedKm: 0,
      includedHours: 0,
      extraKmRate: pricing.extraKmRate,
      extraHourRate: pricing.extraHourRate,
      billableDistance: 0,
      distanceFare: 0,
      extraHourCharge: 0
    };
  }

  if (activeTripType === 'wedding-vip-event' || packageName.includes('wedding') || packageName.includes('vip')) {
    return {
      activeTripType: 'wedding-vip-event',
      packageLabel: 'Wedding / VIP Events',
      packageBaseFare: roundCurrency(tripPackage?.price || pricing.weddingVipCharge),
      includedKm: 0,
      includedHours: 0,
      extraKmRate: pricing.extraKmRate,
      extraHourRate: pricing.extraHourRate,
      billableDistance: 0,
      distanceFare: 0,
      extraHourCharge: 0
    };
  }

  if (activeTripType === 'outstation-package' || activeTripType === 'multi-day-tour' || packageName.includes('outstation')) {
    return {
      activeTripType: 'outstation-package',
      packageLabel: 'Outstation Package',
      packageBaseFare: roundCurrency(tripPackage?.price || pricing.outstationMinCharge),
      includedKm: 300,
      includedHours: 24,
      extraKmRate: pricing.extraKmRate,
      extraHourRate: pricing.extraHourRate,
      billableDistance: 0,
      distanceFare: 0,
      extraHourCharge: 0
    };
  }

  return {
    activeTripType,
    packageLabel: 'Base Fare',
    packageBaseFare: roundCurrency(tripPackage?.price || pricing.baseFare),
    includedKm: pricing.includedKm,
    includedHours: pricing.includedHours,
    extraKmRate: pricing.extraKmRate,
    extraHourRate: pricing.extraHourRate,
    billableDistance: 0,
    distanceFare: 0,
    extraHourCharge: 0
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
        `${ORS_BASE_URL}/v2/directions/driving-car/geojson`,
        {
          coordinates: [resolvedPickupCoordinates, resolvedDropCoordinates],
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

      // OpenRouteService may return a `routes` array (directions API) or a GeoJSON FeatureCollection (`features`).
      let route = response.data?.routes?.[0] || null;
      let fromFeature = null;
      if (!route && Array.isArray(response.data?.features) && response.data.features.length > 0) {
        fromFeature = response.data.features[0];
        route = {
          summary: fromFeature.properties?.summary || fromFeature.properties || {},
          geometry: fromFeature.geometry || fromFeature.geometry?.coordinates
        };
      }

      if (!route) {
        throw new Error('OpenRouteService directions response did not include a usable route feature');
      }

      const distanceKm = toNumber(route.summary?.distance, 0) / 1000;
      const durationMinutes = toNumber(route.summary?.duration, 0) / 60;
      const safeDistanceKm = distanceKm > 0 ? distanceKm : haversineDistanceKm(resolvedPickupCoordinates, resolvedDropCoordinates);
      const safeDurationMinutes = durationMinutes > 0 ? durationMinutes : estimateDurationMinutes(safeDistanceKm);
      const geometry = route.geometry?.coordinates || route.geometry || (fromFeature ? fromFeature.geometry?.coordinates || [] : []);

      debugBookingRoute('directions-response', {
        pickupCoordinates: resolvedPickupCoordinates,
        dropCoordinates: resolvedDropCoordinates,
        distanceKm: safeDistanceKm,
        durationMinutes: safeDurationMinutes,
        hasGeometry: Array.isArray(geometry) ? geometry.length > 0 : Boolean(geometry),
        sourceShape: fromFeature ? 'feature' : 'routes'
      });

      return {
        distanceInKm: safeDistanceKm,
        estimatedDuration: safeDurationMinutes,
        geometry,
        source: 'openrouteservice',
        pickupCoordinates: resolvedPickupCoordinates,
        dropCoordinates: resolvedDropCoordinates,
        raw: fromFeature || route
      };
    } catch (error) {
      const fallbackDistance = haversineDistanceKm(resolvedPickupCoordinates, resolvedDropCoordinates);
      const fallbackDuration = estimateDurationMinutes(fallbackDistance);
      debugBookingRoute('directions-fallback', {
        pickupCoordinates: resolvedPickupCoordinates,
        dropCoordinates: resolvedDropCoordinates,
        status: error?.response?.status,
        responseData: error?.response?.data,
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

function calculateDistanceFare({ tripType, distanceInKm, durationMinutes, pricePerKm, extraKmRate, extraHourRate, includedKm, includedHours, tripPackage, roundTripMultiplier = 1, surgeMultiplier = 1 }) {
  const activeTripType = normalizeTripType(tripType || tripPackage?.packageName || 'one-way');
  const tripDistance = Math.max(0, toNumber(distanceInKm, 0) * Math.max(1, toNumber(roundTripMultiplier, 1)));
  const tripDuration = Math.max(0, toNumber(durationMinutes, 0) * Math.max(1, toNumber(roundTripMultiplier, 1)));
  const ratePerKm = clampMinimum(pricePerKm, clampMinimum(extraKmRate, 0));
  const rateForExtraKm = clampMinimum(extraKmRate, ratePerKm);
  const packageBaseFare = clampMinimum(tripPackage?.price, 0);
  const packageIncludedKm = clampMinimum(tripPackage?.includedKm, includedKm);
  const packageIncludedHours = clampMinimum(tripPackage?.includedHours, includedHours);
  const packageExtraHourRate = clampMinimum(tripPackage?.extraHourRate, clampMinimum(extraHourRate, 0));

  // Local / package trips: base fare is a package that includes kilometers/hours
  if (activeTripType === 'local-package' || activeTripType === 'half-day-package') {
    const billableKm = Math.max(0, tripDistance - packageIncludedKm);
    const billableHours = Math.max(0, tripDuration / 60 - packageIncludedHours);
    let extraKmCharge = roundCurrency(billableKm * rateForExtraKm);
    extraKmCharge = roundCurrency(extraKmCharge * surgeMultiplier);
    const extraHourCharge = roundCurrency(billableHours * packageExtraHourRate);
    const tripDistanceKm = Number(tripDistance.toFixed(2));

    return {
      tripType: activeTripType,
      tripDistance: tripDistanceKm,
      tripDistanceKm,
      billableDistance: Number(billableKm.toFixed(2)),
      distanceKm: tripDistanceKm,
      includedKm: packageIncludedKm,
      includedHours: packageIncludedHours,
      extraKm: Number(billableKm.toFixed(2)),
      extraHours: Number(billableHours.toFixed(2)),
      distanceFare: extraKmCharge,
      distanceCharge: extraKmCharge,
      extraKmCharge,
      extraHourCharge,
      packageBaseFare
    };
  }

  // Outstation trips: charge per km (no implicit base fare), unless package explicitly provided
  if (activeTripType === 'outstation-package' || activeTripType === 'multi-day-tour') {
    let distanceCharge = roundCurrency(tripDistance * ratePerKm);
    distanceCharge = roundCurrency(distanceCharge * surgeMultiplier);
    const tripDistanceKm = Number(tripDistance.toFixed(2));

    return {
      tripType: activeTripType,
      tripDistance: tripDistanceKm,
      tripDistanceKm,
      billableDistance: tripDistanceKm,
      distanceKm: tripDistanceKm,
      includedKm: packageIncludedKm,
      includedHours: packageIncludedHours,
      extraKm: Number(tripDistance.toFixed(2)),
      extraHours: 0,
      distanceFare: distanceCharge,
      distanceCharge,
      extraKmCharge: distanceCharge,
      extraHourCharge: 0,
      packageBaseFare
    };
  }

  // Default: simple per-km charge (one-way, round-trip handled via roundTripMultiplier earlier)
  let distanceCharge = roundCurrency(tripDistance * ratePerKm);
  distanceCharge = roundCurrency(distanceCharge * surgeMultiplier);
  const tripDistanceKm = Number(tripDistance.toFixed(2));

  return {
    tripType: activeTripType,
    tripDistance: tripDistanceKm,
    tripDistanceKm,
    billableDistance: tripDistanceKm,
    distanceKm: tripDistanceKm,
    includedKm: clampMinimum(includedKm, 0),
    includedHours: clampMinimum(includedHours, 0),
    extraKm: Number(tripDistance.toFixed(2)),
    extraHours: 0,
    distanceFare: distanceCharge,
    distanceCharge,
    extraKmCharge: distanceCharge,
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

function calculateNightCharge(distanceFareAmount, pickupDateTime, nightChargePercent, nightChargeFixed = 0) {
  const date = pickupDateTime ? new Date(pickupDateTime) : null;
  if (!date || Number.isNaN(date.getTime())) return 0;

  const hour = date.getHours();
  const isNight = hour >= 22 || hour < 6;
  if (!isNight) return 0;

  if (toNumber(nightChargeFixed, 0) > 0) {
    return roundCurrency(nightChargeFixed);
  }

  return roundCurrency(toNumber(distanceFareAmount, 0) * (toNumber(nightChargePercent, 10) / 100));
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
  const packageLabel = breakdown.packageLabel || (breakdown.tripType === 'local-package' ? 'Local Package' : breakdown.tripType === 'half-day-package' ? 'Half Day Package' : breakdown.tripType === 'airport-transfer' ? 'Airport Pickup / Drop' : breakdown.tripType === 'outstation-package' ? 'Outstation Package' : breakdown.tripType === 'wedding-vip-event' ? 'Wedding / VIP Events' : 'Base Fare');
  const distanceKm = toNumber(breakdown.tripDistanceKm ?? breakdown.distanceKm ?? breakdown.tripDistance ?? breakdown.distanceInKm, 0);
  const billableKm = toNumber(breakdown.extraKm ?? breakdown.billableDistance ?? distanceKm, 0);
  const ratePerKm = toNumber(breakdown.ratePerKm ?? breakdown.pricePerKm ?? breakdown.extraKmRate, 0);
  const driverAllowanceDays = Math.max(1, toNumber(breakdown.driverAllowanceDays, 1));
  const driverAllowancePerDay = toNumber(breakdown.driverAllowancePerDay ?? (driverAllowanceDays ? breakdown.driverAllowance / driverAllowanceDays : 0), 0);
  const extraHours = toNumber(breakdown.extraHours, 0);
  const visibleDistanceAmount = roundCurrency(breakdown.distanceCharge ?? breakdown.distanceFare ?? 0);
  const isPackageTrip = ['local-package', 'half-day-package'].includes(breakdown.tripType);
    const distanceDetails = visibleDistanceAmount > 0
      ? (isPackageTrip && billableKm > 0 && billableKm < distanceKm
        ? `${billableKm.toFixed(1)} KM extra @ ₹${formatRate(ratePerKm)}/KM`
        : `${distanceKm.toFixed(1)} KM @ ₹${formatRate(ratePerKm)}/KM`)
      : `${distanceKm.toFixed(1)} KM included in package`;

  if (breakdown.packageBaseFare > 0) {
    rows.push({
      description: packageLabel === 'Base Fare' ? 'Base Fare / Package Fare' : packageLabel,
      details: 'Fixed Booking Charge',
      quantity: 1,
      unitPrice: breakdown.packageBaseFare,
      tax: 0,
      amount: breakdown.packageBaseFare,
      chargeType: 'baseFare'
    });
  } else if (breakdown.baseFare > 0) {
    rows.push({
      description: 'Base Fare / Package Fare',
      details: 'Fixed Booking Charge',
      quantity: 1,
      unitPrice: breakdown.baseFare,
      tax: 0,
      amount: breakdown.baseFare,
      chargeType: 'baseFare'
    });
  }

  // Distance / extra KM charges
  rows.push({
    description: isPackageTrip ? 'Distance Charge' : 'Distance Charge',
      details: distanceDetails,
    quantity: 1,
    unitPrice: ratePerKm,
    tax: 0,
    amount: visibleDistanceAmount,
    chargeType: 'distanceCharge'
  });

  if (toNumber(breakdown.extraKmCharge, 0) > 0 && roundCurrency(breakdown.extraKmCharge) !== visibleDistanceAmount) {
    rows.push({
      description: 'Extra KM Charge',
      details: `${billableKm.toFixed(1)} KM @ ₹${formatRate(ratePerKm)}/KM`,
      quantity: 1,
      unitPrice: ratePerKm,
      tax: 0,
      amount: roundCurrency(breakdown.extraKmCharge),
      chargeType: 'extraKmCharge'
    });
  }

  if (breakdown.extraHourCharge > 0) {
    rows.push({
      description: 'Extra Hour Charge',
      details: `${extraHours > 0 ? extraHours.toFixed(1) : '1.0'} Hour(s) @ ₹${formatRate(toNumber(breakdown.extraHourRate || breakdown.extraHourCharge, 0))}/Hour`,
      quantity: 1,
      unitPrice: breakdown.extraHourCharge,
      tax: 0,
      amount: breakdown.extraHourCharge,
      chargeType: 'extraHourCharge'
    });
  }

  if (breakdown.tollCharges > 0) {
    rows.push({
      description: 'Toll Charges',
      details: 'Route Toll Charges',
      quantity: 1,
      unitPrice: breakdown.tollCharges,
      tax: 0,
      amount: breakdown.tollCharges,
      chargeType: 'tollCharges'
    });
  }

  if (breakdown.driverAllowance > 0) {
    rows.push({
      description: 'Driver Allowance',
      details: `${driverAllowanceDays} Day${driverAllowanceDays > 1 ? 's' : ''} Driver Allowance`,
      quantity: driverAllowanceDays,
      unitPrice: driverAllowancePerDay || breakdown.driverAllowance,
      tax: 0,
      amount: breakdown.driverAllowance,
      chargeType: 'driverAllowance'
    });
  }

  if (breakdown.parkingCharges > 0) {
    rows.push({
      description: 'Parking Charges',
      details: 'Parking Fees',
      quantity: 1,
      unitPrice: breakdown.parkingCharges,
      tax: 0,
      amount: breakdown.parkingCharges,
      chargeType: 'parkingCharges'
    });
  }

  if (breakdown.permitCharges > 0) {
    rows.push({
      description: 'Permit Charges',
      details: 'State Permit Charges',
      quantity: 1,
      unitPrice: breakdown.permitCharges,
      tax: 0,
      amount: breakdown.permitCharges,
      chargeType: 'permitCharges'
    });
  }

  if (breakdown.waitingCharges > 0) {
    rows.push({
      description: 'Waiting Charges',
      details: 'Waiting Time Charges',
      quantity: 1,
      unitPrice: breakdown.waitingCharges,
      tax: 0,
      amount: breakdown.waitingCharges,
      chargeType: 'waitingCharges'
    });
  }

  if (breakdown.nightCharges > 0) {
    rows.push({
      description: 'Night Charges',
      details: 'Night Travel Surcharge',
      quantity: 1,
      unitPrice: breakdown.nightCharges,
      tax: 0,
      amount: breakdown.nightCharges,
      chargeType: 'nightCharges'
    });
  }

  if (breakdown.extraTravelCharges > 0) {
    rows.push({
      description: 'Extra Travel Charges',
      details: 'Additional Travel Charges',
      quantity: 1,
      unitPrice: breakdown.extraTravelCharges,
      tax: 0,
      amount: breakdown.extraTravelCharges,
      chargeType: 'extraTravelCharges'
    });
  }

  if (breakdown.minimumFareAdjustment > 0) {
    rows.push({
      description: 'Minimum Fare Adjustment',
      details: 'Minimum Fare Top-up',
      quantity: 1,
      unitPrice: breakdown.minimumFareAdjustment,
      tax: 0,
      amount: breakdown.minimumFareAdjustment,
      chargeType: 'minimumFareAdjustment'
    });
  }

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
  const packageProfile = resolvePackageProfile({ tripType: activeTripType, tripPackage, routeEstimate, pricing });
  const localIncludedKm = packageProfile.includedKm || pricing.perDayIncludedKm;
  const localIncludedHours = packageProfile.includedHours || pricing.perDayIncludedHours;
  const distanceQuote = calculateDistanceFare({
    tripType: packageProfile.activeTripType,
    distanceInKm: tripDistance,
    durationMinutes,
    pricePerKm: pricing.pricePerKm,
    extraKmRate: packageProfile.extraKmRate || pricing.extraKmRate,
    extraHourRate: packageProfile.extraHourRate || pricing.extraHourRate,
    includedKm: localIncludedKm,
    includedHours: localIncludedHours,
    tripPackage,
    roundTripMultiplier,
    surgeMultiplier: pricing.surgeMultiplier || 1
  });

  const packageBaseFare = roundCurrency(packageProfile.packageBaseFare || distanceQuote.packageBaseFare || 0);
  const baseFare = packageProfile.activeTripType === 'outstation-package'
    ? (packageBaseFare > 0 ? packageBaseFare : 0)
    : (packageBaseFare || pricing.baseFare);
  const visibleDistanceCharge = routeSource === 'route-table' || ['airport-transfer', 'wedding-vip-event'].includes(packageProfile.activeTripType)
    ? 0
    : roundCurrency(distanceQuote.distanceCharge || distanceQuote.distanceFare || packageProfile.distanceFare || 0);
  const distanceCharge = visibleDistanceCharge;
  const extraKmCharge = roundCurrency(distanceQuote.extraKmCharge || visibleDistanceCharge);
  const extraKmChargeVisible = roundCurrency(extraKmCharge) !== roundCurrency(distanceCharge) ? roundCurrency(extraKmCharge) : 0;
  const tripDaysCount = Math.max(1, toNumber(tripDays, 0) || (activeTripType === 'multi-day-tour' ? 2 : activeTripType === 'round-trip' ? 2 : 1));
  const isLongDistance = !['local-package', 'half-day-package', 'airport-transfer', 'wedding-vip-event'].includes(packageProfile.activeTripType);
  const driverDays = packageProfile.activeTripType === 'multi-day-tour' ? tripDaysCount : packageProfile.activeTripType === 'round-trip' ? 2 : 1;
  const driverAllowancePerDay = pricing.driverAllowancePerDay || pricing.driverAllowance || 0;
  const driverAllowance = isLongDistance ? roundCurrency(driverAllowancePerDay * Math.max(1, driverDays)) : 0;
  const tollChargesAmount = calculateTollCharges({ tollCharges, adminAdjustment: additionalChargeBundle.breakdown.manualAdjustment, routeTollCharges: pricing.tollCharges });
  const parkingChargesAmount = roundCurrency(pricing.parkingCharges + toNumber(additionalChargeBundle.breakdown.parkingCharges, 0));
  const permitChargesAmount = roundCurrency(pricing.permitCharges + pricing.statePermitCharges + toNumber(additionalChargeBundle.breakdown.permitCharges, 0));
  const waitingChargesAmount = calculateWaitingCharges({
    waitingMinutes,
    freeWaitingMinutes: pricing.freeWaitingMinutes,
    waitingChargePerHour: pricing.waitingChargePerHour
  });
  const extraTravelCharges = roundCurrency(
    pricing.luggageCharges +
      pricing.hillAreaCharges +
      pricing.multiDayCharges +
      toNumber(additionalChargeBundle.breakdown.luggageCharges, 0) +
      toNumber(additionalChargeBundle.breakdown.hillAreaCharges, 0) +
      toNumber(additionalChargeBundle.breakdown.multiDayCharges, 0) +
      toNumber(additionalChargeBundle.breakdown.manualAdjustment, 0)
  );
  const nightChargesAmount = calculateNightCharge(distanceCharge || extraKmCharge, pickupDateTime, pricing.nightSurchargePercent, pricing.nightChargeFixed);
  const subtotalBeforeMinimum = roundCurrency(baseFare + distanceCharge + extraKmChargeVisible + driverAllowance + tollChargesAmount + parkingChargesAmount + permitChargesAmount + waitingChargesAmount + nightChargesAmount + extraTravelCharges);
  let subtotalAmount = subtotalBeforeMinimum;
  let minimumFareAdjustment = 0;
  if (pricing.minimumFare && pricing.minimumFare > 0 && subtotalAmount < pricing.minimumFare) {
    minimumFareAdjustment = roundCurrency(pricing.minimumFare - subtotalAmount);
    subtotalAmount = roundCurrency(pricing.minimumFare);
  }
  const discountAmount = 0;
  const gstAmount = calculateGST(subtotalAmount, pricing.gstPercent);
  const totalAmount = roundCurrency(subtotalAmount + gstAmount - discountAmount);
  const cgstAmount = roundCurrency(gstAmount / 2);
  const sgstAmount = roundCurrency(gstAmount - cgstAmount);
  const lineItems = buildBillingLineItems({
    tripType: packageProfile.activeTripType,
    packageLabel: packageProfile.packageLabel,
    packageBaseFare,
    baseFare,
    distanceKm: tripDistance,
    tripDistance,
    ratePerKm: pricing.pricePerKm,
    billableDistance: distanceQuote.billableDistance,
    extraKm: distanceQuote.extraKm ?? distanceQuote.billableDistance,
    distanceCharge,
    distanceFare: distanceCharge,
    extraKmCharge,
    extraHourCharge: roundCurrency(distanceQuote.extraHourCharge),
    extraHourRate: distanceQuote.extraHourCharge > 0 ? pricing.extraHourRate : 0,
    tollCharges: tollChargesAmount,
    driverAllowance,
    driverAllowancePerDay,
    driverAllowanceDays: activeTripType === 'multi-day-tour' ? tripDaysCount : activeTripType === 'round-trip' ? 2 : 1,
    parkingCharges: parkingChargesAmount,
    permitCharges: permitChargesAmount,
    waitingCharges: waitingChargesAmount,
    nightCharges: nightChargesAmount,
    extraTravelCharges,
    minimumFareAdjustment,
    waitingMinutes: Math.max(0, toNumber(waitingMinutes, 0)),
    freeWaitingMinutes: pricing.freeWaitingMinutes,
    nightChargePercent: pricing.nightChargePercent,
    gstPercent: pricing.gstPercent,
    gstAmount,
    subtotalAmount
  });

  const billingBreakdown = {
    tripType: packageProfile.activeTripType,
    packageLabel: packageProfile.packageLabel,
    source: routeSource,
    baseFare,
    packageBaseFare,
    pricePerKm: pricing.pricePerKm,
    ratePerKm: pricing.pricePerKm,
    extraKmRate: pricing.extraKmRate,
    includedKm: localIncludedKm,
    includedHours: localIncludedHours,
    distanceInKm: Number(toNumber(routeEstimate.distanceInKm, 0).toFixed(2)),
    estimatedDuration: Math.round(toNumber(routeEstimate.estimatedDuration, 0)),
    tripDistance: Number(tripDistance.toFixed(2)),
    tripDistanceKm: Number(tripDistance.toFixed(2)),
    distanceKm: Number(tripDistance.toFixed(2)),
    billableDistance: Number(toNumber(distanceQuote.billableDistance, tripDistance).toFixed(2)),
    extraKm: Number(toNumber(distanceQuote.extraKm ?? distanceQuote.billableDistance, tripDistance).toFixed(2)),
    distanceCharge,
    distanceFare: distanceCharge,
    extraKmCharge,
    extraHourCharge: roundCurrency(distanceQuote.extraHourCharge),
    extraHourRate: pricing.extraHourRate,
    tollCharges: tollChargesAmount,
    parkingCharges: parkingChargesAmount,
    permitCharges: permitChargesAmount,
    waitingCharges: waitingChargesAmount,
    nightCharges: nightChargesAmount,
    driverAllowance,
    extraTravelCharges,
    minimumFareAdjustment,
    luggageCharges: roundCurrency(pricing.luggageCharges),
    hillAreaCharges: roundCurrency(pricing.hillAreaCharges),
    multiDayCharges: roundCurrency(pricing.multiDayCharges),
    statePermitCharges: roundCurrency(pricing.statePermitCharges),
    waitingMinutes: Math.max(0, toNumber(waitingMinutes, 0)),
    freeWaitingMinutes: pricing.freeWaitingMinutes,
    waitingChargePerHour: pricing.waitingChargePerHour,
    nightChargePercent: pricing.nightChargePercent,
    driverAllowancePerDay,
    driverAllowanceDays: activeTripType === 'multi-day-tour' ? tripDaysCount : activeTripType === 'round-trip' ? 2 : 1,
    subtotalAmount,
    subtotal: subtotalAmount,
    gstPercent: pricing.gstPercent,
    gstAmount,
    cgstAmount,
    sgstAmount,
    totalAmount,
    totalFare: totalAmount,
    discountAmount,
    currency: 'INR',
    passengers: passengers || '',
    lineItems
  };

  const reconciliation = validateBillingBreakdown(billingBreakdown, lineItems);
  if (!reconciliation.ok) {
    const error = new Error('Billing reconciliation failed');
    error.details = reconciliation;
    throw error;
  }

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
    distanceInKm: billingBreakdown.distanceInKm,
    estimatedDuration: billingBreakdown.estimatedDuration,
    billingBreakdown,
    fareBreakdown: billingBreakdown,
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
  roundCurrency,
  normalizeCoordinates,
  normalizeTripType,
  resolvePlaces,
  resolveRouteEstimate,
  resolveVehiclePricing,
  validateBillingBreakdown,
  reverseGeocodeCoordinates
};