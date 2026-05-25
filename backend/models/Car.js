const mongoose = require('mongoose');

const carSchema = new mongoose.Schema(
  {
    carName: { type: String, required: true, unique: true, trim: true },
    image: { type: String, required: true },
    seatingCapacity: { type: Number, required: true },
    category: { type: String, required: true },
    fuelType: { type: String, required: true },
    transmission: { type: String, required: true },
    pricePerDay: { type: Number, required: true },
    baseFare: { type: Number, default: 0 },
    pricePerKm: { type: Number, default: 0 },
    extraKmRate: { type: Number, default: 0 },
    nightChargePercent: { type: Number, default: 10 },
    driverAllowance: { type: Number, default: 0 },
    includedKm: { type: Number, default: 0 },
    availability: { type: Boolean, default: true },
    features: [{ type: String }]
  },
  { timestamps: true }
);

module.exports = mongoose.model('Car', carSchema);