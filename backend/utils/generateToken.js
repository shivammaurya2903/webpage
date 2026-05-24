const jwt = require('jsonwebtoken');

function signToken(payload) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
  }

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
}

function attachToken(res, user, statusCode = 200) {
  const token = signToken({ id: user._id, type: 'user' });
  const cookieDays = Number(process.env.JWT_COOKIE_EXPIRES_IN || 7);

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: cookieDays * 24 * 60 * 60 * 1000
  };

  res.cookie('token', token, cookieOptions);
  return res.status(statusCode).json({
    success: true,
    token,
    user: user.toSafeJSON ? user.toSafeJSON() : user
  });
}

function attachAdminToken(res, admin, statusCode = 200) {
  const token = signToken({ id: admin._id, type: 'admin' });
  const cookieDays = Number(process.env.JWT_COOKIE_EXPIRES_IN || 7);

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: cookieDays * 24 * 60 * 60 * 1000
  };

  res.cookie('token', token, cookieOptions);
  return res.status(statusCode).json({
    success: true,
    token,
    admin: admin.toSafeJSON ? admin.toSafeJSON() : admin
  });
}

module.exports = { signToken, attachToken, attachAdminToken };