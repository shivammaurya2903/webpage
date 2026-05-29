/* Create an admin user quickly for local testing
Usage: node tools/createAdmin.js <email> <password> <phone> [name]
*/

require('dotenv').config();
const { connectDB } = require('../config/db');
const Admin = require('../models/Admin');

const FULL_ADMIN_PERMISSIONS = Admin.fullPermissions || [
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

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: node tools/createAdmin.js <email> <password> <phone> [name]');
    process.exit(1);
  }

  const [email, password, phone, name = 'Local Admin'] = args;

  try {
    await connectDB();
    const existing = await Admin.findOne({ email }).select('+password');
    if (existing) {
      console.log('Admin already exists. Updating password and info...');
      existing.name = name;
      existing.phone = phone;
      existing.set('password', password);
      existing.permissions = [...FULL_ADMIN_PERMISSIONS];
      existing.isActive = true;
      await existing.save();
      console.log('Admin updated:', email);
      process.exit(0);
    }

    await Admin.create({ name, email, password, phone, role: 'admin', permissions: [...FULL_ADMIN_PERMISSIONS], isActive: true });
    console.log('Admin created:', email);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create admin:', err);
    process.exit(2);
  }
}

main();
