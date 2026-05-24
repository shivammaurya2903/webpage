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
    distance: { type: String, default: '' },
    fareBreakdown: { type: Object, default: {} },
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
    taxAmount: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    finalBill: { type: Object, default: {} },
    pdfPath: { type: String, default: '' },
    sentAt: { type: Date, default: null },
    paidAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Invoice', invoiceSchema);