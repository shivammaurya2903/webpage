const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Car = require('../models/Car');
const SiteSettings = require('../models/SiteSettings');
const { calculateFareQuote, resolvePlaces, reverseGeocodeCoordinates } = require('../services/fareCalculator');

function parseCoordinates(value) {
  if (!value) return null;
  if (Array.isArray(value) && value.length >= 2) {
    const longitude = Number(value[0]);
    const latitude = Number(value[1]);
    return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
  }
  if (typeof value === 'string') {
    const parts = value.split(',').map((part) => Number(part.trim()));
    if (parts.length >= 2 && parts.every(Number.isFinite)) return parts;
  }
  if (typeof value === 'object') {
    const longitude = Number(value.longitude ?? value.lng ?? value.lon);
    const latitude = Number(value.latitude ?? value.lat);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) return [longitude, latitude];
  }
  return null;
}

const calculateFare = asyncHandler(async (req, res) => {
  const { pickup, drop, vehicleId, selectedCar, tripType, pickupDateTime, waitingMinutes, tollCharges } = req.body || {};

  if (!pickup || !drop) {
    throw new ApiError(400, 'Pickup and drop details are required');
  }

  const [vehicle, settings] = await Promise.all([
    vehicleId ? Car.findById(vehicleId).lean() : selectedCar ? Car.findOne({ carName: new RegExp(`^${String(selectedCar).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean() : null,
    SiteSettings.findOne({}).lean()
  ]);

  const quote = await calculateFareQuote({
    pickup: {
      address: pickup.address || pickup.location || pickup.text || pickup.label || '',
      coordinates: parseCoordinates(pickup.coordinates || pickup.coords || pickup.position)
    },
    drop: {
      address: drop.address || drop.location || drop.text || drop.label || '',
      coordinates: parseCoordinates(drop.coordinates || drop.coords || drop.position)
    },
    vehicle,
    vehicleId,
    selectedCar,
    tripType,
    pickupDateTime,
    waitingMinutes,
    tollCharges,
    settings
  });

  res.json({
    success: true,
    message: 'Fare calculated successfully',
    distanceKm: quote.distanceInKm,
    durationMinutes: quote.estimatedDuration,
    gst: quote.fareBreakdown.gstAmount,
    totalFare: quote.totalFare,
    fareBreakdown: quote.fareBreakdown,
    routeGeometry: quote.routeGeometry,
    vehicle: quote.vehicle,
    source: quote.source
  });
});

const reverseGeocodeLocation = asyncHandler(async (req, res) => {
  const longitude = Number(req.query.lng ?? req.query.lon ?? req.query.longitude);
  const latitude = Number(req.query.lat ?? req.query.latitude);

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new ApiError(400, 'Valid longitude and latitude are required');
  }

  const location = await reverseGeocodeCoordinates({ longitude, latitude });
  res.json({
    success: true,
    location
  });
});

const geocodeLocation = asyncHandler(async (req, res) => {
  const query = String(req.query.query || req.query.text || '').trim();
  if (!query) {
    return res.json({ success: true, suggestions: [] });
  }

  const suggestions = await resolvePlaces(query, Math.min(8, Math.max(1, Number(req.query.limit || 5))));
  res.json({ success: true, suggestions });
});

module.exports = { calculateFare, geocodeLocation, reverseGeocodeLocation };