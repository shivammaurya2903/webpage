const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema(
  {
    invoiceId: { type: String, unique: true, index: true, required: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    bookingId: { type: String, required: true, index: true },
    customerName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true },
    pickupLocation: { type: String, required: true, trim: true },
    dropLocation: { type: String, required: true, trim: true },
    pickupDate: { type: Date, required: true },
    pickupTime: { type: String, required: true },
    vehicle: { type: String, default: '' },
    driverName: { type: String, default: '' },
    driverPhone: { type: String, default: '' },
    carType: { type: String, default: '' },
    distanceValue: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    pricePerKm: { type: Number, default: 0 },
    distanceFare: { type: Number, default: 0 },
    tollCharges: { type: Number, default: 0 },
    waitingCharges: { type: Number, default: 0 },
    nightCharges: { type: Number, default: 0 },
    driverAllowance: { type: Number, default: 0 },
    extraCharges: { type: Number, default: 0 },
    businessSnapshot: { type: Object, default: {} },
    customerSnapshot: { type: Object, default: {} },
    rideSnapshot: { type: Object, default: {} },
    distance: { type: String, default: '' },
    fareBreakdown: { type: Object, default: {} },
    lineItems: { type: Array, default: [] },
    paymentMethod: {
      type: String,
      enum: ['Cash', 'UPI', 'Card', 'Online payment link', 'Bank transfer', 'Partially Paid', 'Pending', ''],
      default: ''
    },
    paymentStatus: {
      type: String,
      enum: ['Unpaid', 'Pending', 'Paid Online', 'Paid Offline', 'Partially Paid', 'Paid', ''],
      default: 'Pending'
    },
    totalFare: { type: Number, required: true },
    subtotalAmount: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    cgstAmount: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    taxPercent: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    finalBill: { type: Object, default: {} },
    paymentSummary: { type: Object, default: {} },
    terms: { type: Array, default: [] },
    pdfPath: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    paidAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Invoice', invoiceSchema);