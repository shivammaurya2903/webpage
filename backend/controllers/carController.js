const Car = require('../models/Car');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const listCars = asyncHandler(async (req, res) => {
  const cars = await Car.find({}).sort({ createdAt: -1 }).lean();
  res.json({ success: true, cars });
});

const createCar = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (req.file) payload.image = `/uploads/${req.file.filename}`;
  payload.pricePerDay = Number(payload.pricePerDay || payload.baseFare || 0);
  payload.baseFare = Number(payload.baseFare || payload.pricePerDay || 0);
  payload.pricePerKm = Number(payload.pricePerKm || 0);
  payload.extraKmRate = Number(payload.extraKmRate || payload.pricePerKm || 0);
  payload.nightChargePercent = Number(payload.nightChargePercent || 10);
  payload.driverAllowance = Number(payload.driverAllowance || 0);
  payload.includedKm = Number(payload.includedKm || 0);
  const car = await Car.create(payload);
  res.status(201).json({ success: true, car });
});

const updateCar = asyncHandler(async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (!car) throw new ApiError(404, 'Car not found');

  Object.assign(car, req.body);
  if (req.body.baseFare) car.baseFare = Number(req.body.baseFare);
  if (req.body.pricePerKm) car.pricePerKm = Number(req.body.pricePerKm);
  if (req.body.extraKmRate) car.extraKmRate = Number(req.body.extraKmRate);
  if (req.body.nightChargePercent) car.nightChargePercent = Number(req.body.nightChargePercent);
  if (req.body.driverAllowance) car.driverAllowance = Number(req.body.driverAllowance);
  if (req.body.includedKm) car.includedKm = Number(req.body.includedKm);
  if (req.file) car.image = `/uploads/${req.file.filename}`;
  await car.save();
  res.json({ success: true, car });
});

const deleteCar = asyncHandler(async (req, res) => {
  const car = await Car.findByIdAndDelete(req.params.id);
  if (!car) throw new ApiError(404, 'Car not found');
  res.json({ success: true, message: 'Car deleted successfully' });
});

module.exports = { listCars, createCar, updateCar, deleteCar };