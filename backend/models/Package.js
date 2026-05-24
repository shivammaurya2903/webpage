const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema(
  {
    packageName: { type: String, required: true, unique: true, trim: true },
    image: { type: String, required: true },
    destinations: [{ type: String }],
    duration: { type: String, required: true },
    price: { type: Number, required: true },
    inclusions: [{ type: String }],
    exclusions: [{ type: String }],
    description: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Package', packageSchema);