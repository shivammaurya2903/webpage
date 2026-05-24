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
  const car = await Car.create(payload);
  res.status(201).json({ success: true, car });
});

const updateCar = asyncHandler(async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (!car) throw new ApiError(404, 'Car not found');

  Object.assign(car, req.body);
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