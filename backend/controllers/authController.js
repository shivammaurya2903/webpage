const User = require('../models/User');
const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { attachToken, clearAuthCookie } = require('../utils/generateToken');
const { sendTemplateEmail } = require('../services/emailService');

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

function buildOrigin() {
  const configuredOrigin = String(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || '').trim();
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, '');

  const fallbackOrigins = String(process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  return (fallbackOrigins[0] || 'http://localhost:5000').replace(/\/$/, '');
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

const requestPasswordReset = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new ApiError(400, 'Valid email is required');
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    return res.json({
      success: true,
      message: 'If the account exists, password reset instructions have been sent.'
    });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
  await user.save();

  const resetUrl = `${buildOrigin()}/?resetToken=${rawToken}`;
  await sendTemplateEmail('passwordReset', user.email, [user.name, resetUrl, 15], 'Reset your password');

  const response = {
    success: true,
    message: 'If the account exists, password reset instructions have been sent.'
  };

  if (process.env.NODE_ENV !== 'production' && !process.env.EMAIL_HOST) {
    response.resetUrl = resetUrl;
  }

  res.json(response);
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    throw new ApiError(400, 'Token and new password are required');
  }

  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: tokenHash,
    resetPasswordExpires: { $gt: new Date() }
  });

  if (!user) {
    throw new ApiError(400, 'Reset token is invalid or expired');
  }

  user.password = password;
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  await user.save();

  res.json({ success: true, message: 'Password updated successfully' });
});

const logout = asyncHandler(async (req, res) => {
  clearAuthCookie(res);

  res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = { register, login, profile, requestPasswordReset, resetPassword, logout };