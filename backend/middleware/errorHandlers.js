const ApiError = require('../utils/ApiError');

function redactLogValue(key, value) {
  const sensitiveKeys = ['password', 'confirmPassword', 'token', 'authorization', 'secret'];
  if (sensitiveKeys.includes(String(key || '').toLowerCase())) {
    return '[redacted]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue('', item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactLogValue(entryKey, entryValue)]));
  }

  return value;
}

function getRequestBody(req) {
  if (!req || !req.body || typeof req.body !== 'object') return undefined;
  return redactLogValue('', req.body);
}

function notFound(req, res, next) {
  next(new ApiError(404, `Not found - ${req.originalUrl}`));
}

function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || res.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let details = err.details || null;

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((item) => ({
      field: item.path,
      message: item.message
    }));
  }

  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid ${err.path}`;
  }

  if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate value found';
    const field = Object.keys(err.keyValue || {})[0];
    details = field ? [{ field, message: `${field} already exists` }] : null;
  }

  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Authentication token has expired';
  }

  if (statusCode >= 500) {
    message = 'Something went wrong.';
    details = null;
  }

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[api:error]', {
      method: req.method,
      endpoint: req.originalUrl,
      statusCode,
      requestBody: getRequestBody(req),
      responseBody: {
        success: false,
        message,
        details
      },
      cause: err?.stack || err?.message || err
    });
  }

  res.status(statusCode).json({
    success: false,
    message,
    details
  });
}

module.exports = { notFound, errorHandler };