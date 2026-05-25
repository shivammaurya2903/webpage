const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { attachToken } = require('../utils/generateToken');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeIndianPhone(value) {
  const cleaned = String(value || '').trim().replace(/[\s-]/g, '');
  if (!cleaned || /[^+0-9]/.test(cleaned)) return '';

  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  }

  return /^[6-9][0-9]{9}$/.test(digits) ? `+91${digits}` : '';
}

const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role } = req.body;

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizeIndianPhone(phone);

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

  if (user.isBlocked) {
    throw new ApiError(403, 'This account has been blocked');
  }

  user.lastLoginAt = new Date();
  await user.save();

  return attachToken(res, user, 200);
});

const profile = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user.toSafeJSON() });
});

module.exports = { register, login, profile };