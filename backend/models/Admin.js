const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const FULL_ADMIN_PERMISSIONS = [
  'manage_users',
  'manage_bookings',
  'manage_vehicles',
  'manage_drivers',
  'manage_invoices',
  'manage_payments',
  'manage_notifications',
  'manage_routes',
  'manage_packages',
  'view_analytics',
  'manage_crud'
];

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, required: true, minlength: 8, select: false },
    phone: { type: String, required: true },
    role: { type: String, enum: ['admin'], default: 'admin' },
    permissions: {
      type: [String],
      default: () => [...FULL_ADMIN_PERMISSIONS]
    },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null }
  },
  { timestamps: true }
);

adminSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  return next();
});

adminSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

adminSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    permissions: Array.isArray(this.permissions) ? this.permissions : [...FULL_ADMIN_PERMISSIONS],
    phone: this.phone,
    isActive: this.isActive,
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt
  };
};

adminSchema.statics.fullPermissions = FULL_ADMIN_PERMISSIONS;

module.exports = mongoose.model('Admin', adminSchema);