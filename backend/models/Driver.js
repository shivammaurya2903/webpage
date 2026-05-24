const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema(
  {
    driverName: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    vehicleAssigned: { type: String, default: '' },
    licenseNumber: { type: String, required: true, unique: true, index: true },
    availability: { type: Boolean, default: true },
    currentLocation: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Driver', driverSchema);