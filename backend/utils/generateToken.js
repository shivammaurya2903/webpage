const jwt = require('jsonwebtoken');

function signToken(payload) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
  }

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
}

function buildTokenPayload(account, type) {
  return {
    id: account._id,
    userId: account._id,
    email: account.email,
    role: account.role,
    type
  };
}

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  };
}

function attachToken(res, user, statusCode = 200) {
  const token = signToken(buildTokenPayload(user, user.role === 'admin' ? 'admin' : 'user'));
  const cookieDays = Number(process.env.JWT_COOKIE_EXPIRES_IN || 7);

  const cookieOptions = { ...getCookieOptions(), maxAge: cookieDays * 24 * 60 * 60 * 1000 };

  res.cookie('token', token, cookieOptions);
  return res.status(statusCode).json({
    success: true,
    token,
    user: user.toSafeJSON ? user.toSafeJSON() : user
  });
}

function attachAdminToken(res, admin, statusCode = 200) {
  const token = signToken(buildTokenPayload(admin, 'admin'));
  const cookieDays = Number(process.env.JWT_COOKIE_EXPIRES_IN || 7);

  const cookieOptions = { ...getCookieOptions(), maxAge: cookieDays * 24 * 60 * 60 * 1000 };

  res.cookie('token', token, cookieOptions);
  return res.status(statusCode).json({
    success: true,
    token,
    user: admin.toSafeJSON ? admin.toSafeJSON() : admin,
    admin: admin.toSafeJSON ? admin.toSafeJSON() : admin
  });
}

function clearAuthCookie(res) {
  res.clearCookie('token', getCookieOptions());
}

module.exports = { signToken, attachToken, attachAdminToken, clearAuthCookie, getCookieOptions };