function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value) {
  return Math.max(0, Math.round(toNumber(value, 0)));
}

function validateBillingBreakdown(breakdown = {}, lineItems = []) {
  const visibleRows = Array.isArray(lineItems)
    ? lineItems.filter((row) => !row?.isSummaryRow && !row?.isTaxRow && !row?.isDiscountRow)
    : [];

  const visibleSum = roundCurrency(visibleRows.reduce((sum, row) => sum + toNumber(row?.amount, 0), 0));
  const subtotal = roundCurrency(breakdown.subtotal);
  const gstAmount = roundCurrency(breakdown.gstAmount);
  const discountAmount = roundCurrency(breakdown.discountAmount);
  const totalAmount = roundCurrency(breakdown.totalAmount);
  const expectedTotal = roundCurrency(subtotal + gstAmount - discountAmount);
  const issues = [];

  if (subtotal !== visibleSum) {
    issues.push({
      field: 'subtotal',
      expected: visibleSum,
      actual: subtotal,
      message: 'Subtotal does not equal the sum of visible charge rows'
    });
  }

  if (gstAmount !== roundCurrency(subtotal * (toNumber(breakdown.gstPercent, 0) / 100))) {
    issues.push({
      field: 'gstAmount',
      expected: roundCurrency(subtotal * (toNumber(breakdown.gstPercent, 0) / 100)),
      actual: gstAmount,
      message: 'GST does not match subtotal and GST rate'
    });
  }

  if (totalAmount !== expectedTotal) {
    issues.push({
      field: 'totalAmount',
      expected: expectedTotal,
      actual: totalAmount,
      message: 'Grand total does not equal subtotal + GST - discount'
    });
  }

  return {
    ok: issues.length === 0,
    visibleSum,
    expectedTotal,
    issues
  };
}

module.exports = {
  roundCurrency,
  toNumber,
  validateBillingBreakdown
};