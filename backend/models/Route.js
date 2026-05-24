const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema(
  {
    from: { type: String, required: true, trim: true },
    to: { type: String, required: true, trim: true },
    distance: { type: String, default: '' },
    estimatedTime: { type: String, default: '' },
    price: { type: Number, required: true }
  },
  { timestamps: true }
);

routeSchema.index({ from: 1, to: 1 }, { unique: true });

module.exports = mongoose.model('Route', routeSchema);