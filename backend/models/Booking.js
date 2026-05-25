const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, unique: true, index: true },
    customerName: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    pickupLocation: { type: String, required: true, trim: true },
    dropLocation: { type: String, required: true, trim: true },
    pickupDate: { type: Date, required: true },
    pickupTime: { type: String, required: true },
    passengers: { type: String, required: true },
    selectedCar: { type: String, required: true },
    selectedPackage: { type: String, required: true },
    tripType: { type: String, default: '' },
    distanceInKm: { type: Number, default: 0 },
    estimatedDuration: { type: Number, default: 0 },
    baseFare: { type: Number, default: 0 },
    perKmRate: { type: Number, default: 0 },
    distanceFare: { type: Number, default: 0 },
    tollCharges: { type: Number, default: 0 },
    waitingCharges: { type: Number, default: 0 },
    nightCharges: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    estimatedFare: { type: Number, required: true },
    totalFare: { type: Number, default: 0 },
    finalBill: { type: Object, default: {} },
    invoiceId: { type: String, default: '' },
    invoiceGenerated: { type: Boolean, default: false },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    paymentMethod: {
      type: String,
      enum: ['Cash', 'UPI', 'Card', 'Online payment link', 'Bank transfer', ''],
      default: ''
    },
    paymentStatus: {
      type: String,
      enum: ['Unpaid', 'Pending', 'Paid Online', 'Paid Offline', 'Partially Paid', 'Advance Paid', 'Fully Paid', 'Failed', 'Refunded'],
      default: 'Unpaid'
    },
    bookingStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Driver Assigned', 'Ride Started', 'Ride Completed', 'Invoice Generated', 'Paid', 'Cancelled', 'Accepted', 'Payment Pending', 'Fully Paid'],
      default: 'Pending'
    },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    rideStartedAt: { type: Date, default: null },
    rideCompletedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '' },
    adminNotes: { type: String, default: '' },
    assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
    specialRequirements: { type: String, default: '' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    customerInvoiceEmailSentAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Booking', bookingSchema);