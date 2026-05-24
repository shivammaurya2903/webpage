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
    availability: { type: Boolean, default: true },
    features: [{ type: String }]
  },
  { timestamps: true }
);

module.exports = mongoose.model('Car', carSchema);