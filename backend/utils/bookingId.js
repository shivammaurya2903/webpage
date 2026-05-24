const crypto = require('crypto');

function createBookingId() {
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TRV-${Date.now().toString(36).toUpperCase()}-${suffix}`;
}

module.exports = { createBookingId };