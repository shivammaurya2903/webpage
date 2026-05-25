function createInvoiceId() {
  // Compact enterprise-grade invoice id.
  // Example: INV-250525-9XQ
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  // Small random suffix to keep uniqueness without long IDs
  const randomPart = Math.random().toString(36).slice(2, 5).toUpperCase();

  return `INV-${yy}${mm}${dd}-${randomPart}`;
}

module.exports = { createInvoiceId };
