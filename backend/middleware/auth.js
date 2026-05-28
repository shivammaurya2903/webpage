const jwt = require('jsonwebtoken');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');
const Admin = require('../models/Admin');

function getTokenFromRequest(req) {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }

  if (req.cookies?.token) {
    return req.cookies.token;
  }

  return null;
}

function isValidTokenType(type) {
  return type === 'user' || type === 'admin';
}

const protect = asyncHandler(async (req, res, next) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    throw new ApiError(401, 'Authentication required');
  }

  if (!process.env.JWT_SECRET) {
    throw new ApiError(500, 'JWT_SECRET is not configured');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Authentication token has expired');
    }

    throw new ApiError(401, 'Invalid authentication token');
  }

  if (!isValidTokenType(decoded.type)) {
    throw new ApiError(401, 'Invalid authentication token');
  }

  const model = decoded.type === 'admin' ? Admin : User;
  const user = await model.findById(decoded.id);

  if (!user) {
    throw new ApiError(401, 'User no longer exists');
  }

  if (user.isBlocked) {
    throw new ApiError(403, 'This account has been blocked');
  }

  req.user = user;
  next();
});

const optionalProtect = asyncHandler(async (req, res, next) => {
  const token = getTokenFromRequest(req);

  if (!token || !process.env.JWT_SECRET) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!isValidTokenType(decoded.type)) {
      return next();
    }
    const model = decoded.type === 'admin' ? Admin : User;
    const user = await model.findById(decoded.id);

    if (user) {
      req.user = user;
    }
  } catch (error) {
    req.user = undefined;
  }

  return next();
});

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(new ApiError(401, 'Authentication required'));
  if (!roles.includes(req.user.role)) {
    return next(new ApiError(403, 'You do not have permission to perform this action'));
  }
  return next();
};

module.exports = { protect, optionalProtect, authorize };