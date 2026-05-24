const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { attachToken } = require('../utils/generateToken');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role } = req.body;

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = String(phone || '').trim();

  if (!name?.trim() || !normalizedEmail || !password || !normalizedPhone) {
    throw new ApiError(400, 'All registration fields are required');
  }

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) throw new ApiError(400, 'Email already exists');

  const isAdminRequest = req.user?.role === 'admin' && role === 'admin';

  let user;
  try {
    user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      phone: normalizedPhone,
      role: isAdminRequest ? 'admin' : 'customer'
    });
  } catch (error) {
    if (error.code === 11000 && error.keyValue?.email) {
      throw new ApiError(400, 'Email already exists');
    }

    throw error;
  }

  return attachToken(res, user, 201);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    throw new ApiError(400, 'Email and password are required');
  }

  const user = await User.findOne({ email: normalizedEmail }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  return attachToken(res, user, 200);
});

const profile = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user.toSafeJSON() });
});

module.exports = { register, login, profile };