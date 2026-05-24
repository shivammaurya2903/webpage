const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    recipientRole: { type: String, default: 'admin' },
    recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    readAt: { type: Date, default: null },
    metadata: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);