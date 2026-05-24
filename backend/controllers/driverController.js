const Driver = require('../models/Driver');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const listDrivers = asyncHandler(async (req, res) => {
  const drivers = await Driver.find({}).sort({ createdAt: -1 }).lean();
  res.json({ success: true, drivers });
});

const createDriver = asyncHandler(async (req, res) => {
  const driver = await Driver.create(req.body);
  res.status(201).json({ success: true, driver });
});

const updateDriver = asyncHandler(async (req, res) => {
  const driver = await Driver.findById(req.params.id);
  if (!driver) throw new ApiError(404, 'Driver not found');
  Object.assign(driver, req.body);
  await driver.save();
  res.json({ success: true, driver });
});

const deleteDriver = asyncHandler(async (req, res) => {
  const driver = await Driver.findByIdAndDelete(req.params.id);
  if (!driver) throw new ApiError(404, 'Driver not found');
  res.json({ success: true, message: 'Driver deleted successfully' });
});

module.exports = { listDrivers, createDriver, updateDriver, deleteDriver };