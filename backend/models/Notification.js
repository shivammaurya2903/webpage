const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    bookingId: { type: String, default: '', index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    recipientRole: { type: String, default: 'admin' },
    recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    eventKey: { type: String, default: '', index: true },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);