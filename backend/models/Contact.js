const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true },
    subject: { type: String, default: 'General Inquiry' },
    message: { type: String, required: true },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    reply: { type: String, default: '' },
    repliedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Contact', contactSchema);