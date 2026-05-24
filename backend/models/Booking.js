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
    estimatedFare: { type: Number, required: true },
    bookingAdvance: { type: Number, required: true },
    remainingPayment: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Advance Paid', 'Fully Paid', 'Failed', 'Refunded'],
      default: 'Pending'
    },
    bookingStatus: {
      type: String,
      enum: ['Pending', 'Accepted', 'Driver Assigned', 'Ride Started', 'Ride Completed', 'Payment Pending', 'Fully Paid', 'Cancelled'],
      default: 'Pending'
    },
    rejectionReason: { type: String, default: '' },
    adminNotes: { type: String, default: '' },
    assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', default: null },
    specialRequirements: { type: String, default: '' },
    paymentId: { type: String, default: '' },
    transactionId: { type: String, default: '' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paymentSessionId: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Booking', bookingSchema);