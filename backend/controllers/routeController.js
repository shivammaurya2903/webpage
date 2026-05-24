const Route = require('../models/Route');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const listRoutes = asyncHandler(async (req, res) => {
  const routes = await Route.find({}).sort({ createdAt: -1 }).lean();
  res.json({ success: true, routes });
});

const createRoute = asyncHandler(async (req, res) => {
  const route = await Route.create(req.body);
  res.status(201).json({ success: true, route });
});

const updateRoute = asyncHandler(async (req, res) => {
  const route = await Route.findById(req.params.id);
  if (!route) throw new ApiError(404, 'Route not found');
  Object.assign(route, req.body);
  await route.save();
  res.json({ success: true, route });
});

const deleteRoute = asyncHandler(async (req, res) => {
  const route = await Route.findByIdAndDelete(req.params.id);
  if (!route) throw new ApiError(404, 'Route not found');
  res.json({ success: true, message: 'Route deleted successfully' });
});

module.exports = { listRoutes, createRoute, updateRoute, deleteRoute };