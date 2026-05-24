const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    provider: { type: String, enum: ['stripe', 'manual'], default: 'manual' },
    providerSessionId: { type: String, default: '' },
    providerPaymentId: { type: String, default: '' },
    paymentType: {
      type: String,
      enum: ['Cash', 'UPI', 'Card', 'Online payment link', 'Bank transfer', 'Partially Paid', 'advance', 'remaining', 'manual'],
      required: true
    },
    paymentMethod: {
      type: String,
      enum: ['Cash', 'UPI', 'Card', 'Online payment link', 'Bank transfer', 'Partially Paid', ''],
      default: ''
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'inr' },
    status: { type: String, enum: ['Pending', 'Completed', 'Partially Paid', 'Failed', 'Refunded'], default: 'Pending' },
    metadata: { type: Object, default: {} },
    notes: { type: String, default: '' },
    proofUrl: { type: String, default: '' },
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    receiptId: { type: String, default: '' },
    refundedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);