const Package = require('../models/Package');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sanitizeImageUrl } = require('../utils/imageUrl');

const listPackages = asyncHandler(async (req, res) => {
  const packages = await Package.find({}).sort({ createdAt: -1 }).lean();
  res.json({ success: true, packages });
});

const createPackage = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  payload.image = sanitizeImageUrl(payload.image, '');
  const tripPackage = await Package.create(payload);
  res.status(201).json({ success: true, package: tripPackage });
});

const updatePackage = asyncHandler(async (req, res) => {
  const tripPackage = await Package.findById(req.params.id);
  if (!tripPackage) throw new ApiError(404, 'Package not found');

  Object.assign(tripPackage, req.body);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'image')) tripPackage.image = sanitizeImageUrl(req.body.image, tripPackage.image || '');
  await tripPackage.save();
  res.json({ success: true, package: tripPackage });
});

const deletePackage = asyncHandler(async (req, res) => {
  const tripPackage = await Package.findByIdAndDelete(req.params.id);
  if (!tripPackage) throw new ApiError(404, 'Package not found');
  res.json({ success: true, message: 'Package deleted successfully' });
});

module.exports = { listPackages, createPackage, updatePackage, deletePackage };