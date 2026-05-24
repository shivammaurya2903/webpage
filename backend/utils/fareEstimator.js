function parsePassengerCount(passengers) {
  const matches = String(passengers || '').match(/\d+/g);
  if (!matches?.length) return 1;
  return Math.max(1, Number(matches[0]));
}

function estimateFare({ car, tripPackage, route, passengers }) {
  const passengerCount = parsePassengerCount(passengers);
  const baseCarRate = Number(car?.pricePerDay || 0);
  const packageRate = Number(tripPackage?.price || 0);
  const routeRate = Number(route?.price || 0);
  const comfortFactor = passengerCount > 4 ? passengerCount * 400 : passengerCount * 250;

  const estimatedFare = Math.max(
    packageRate || 0,
    routeRate || 0,
    baseCarRate + comfortFactor,
    5000
  );

  const advancePercent = Number(process.env.MAX_BOOKING_ADVANCE_PERCENT || 20);
  const bookingAdvance = Math.max(1000, Math.round((estimatedFare * advancePercent) / 100));
  const remainingPayment = Math.max(0, estimatedFare - bookingAdvance);

  return {
    estimatedFare,
    bookingAdvance,
    remainingPayment,
    passengerCount
  };
}

module.exports = { estimateFare };