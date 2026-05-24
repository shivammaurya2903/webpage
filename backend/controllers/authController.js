const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { attachToken } = require('../utils/generateToken');

const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role } = req.body;

  const existingUser = await User.findOne({ email: String(email).toLowerCase() });
  if (existingUser) throw new ApiError(400, 'Email already exists');

  const isAdminRequest = req.user?.role === 'admin' && role === 'admin';
  const user = await User.create({
    name,
    email,
    password,
    phone,
    role: isAdminRequest ? 'admin' : 'customer'
  });

  return attachToken(res, user, 201);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  user.password = undefined;
  return attachToken(res, user, 200);
});

const profile = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user.toSafeJSON() });
});

module.exports = { register, login, profile };