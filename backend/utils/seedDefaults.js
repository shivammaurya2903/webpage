const Car = require('../models/Car');
const Package = require('../models/Package');
const Route = require('../models/Route');
const Driver = require('../models/Driver');
const Admin = require('../models/Admin');
const SiteSettings = require('../models/SiteSettings');

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

function normalizeAdminEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAdminPhone(value) {
  return String(value || '').trim();
}

function hasAllAdminPermissions(permissions) {
  if (!Array.isArray(permissions)) return false;
  const current = new Set(permissions.map((permission) => String(permission || '').trim()).filter(Boolean));
  return FULL_ADMIN_PERMISSIONS.every((permission) => current.has(permission));
}

async function seedCollection(Model, seedRows, uniqueKey) {
  const count = await Model.countDocuments();
  if (count > 0) return;

  const rows = seedRows.map((row) => ({ ...row }));
  if (uniqueKey) {
    const existing = await Model.find({ [uniqueKey]: { $in: rows.map((row) => row[uniqueKey]) } }).select(uniqueKey);
    const existingValues = new Set(existing.map((item) => item[uniqueKey]));
    const missing = rows.filter((row) => !existingValues.has(row[uniqueKey]));
    if (missing.length) await Model.insertMany(missing);
    return;
  }

  if (rows.length) await Model.insertMany(rows);
}

async function seedDefaults() {
  const adminCount = await Admin.countDocuments();
  const adminEmail = normalizeAdminEmail(process.env.ADMIN_EMAIL);
  const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  const adminPhone = normalizeAdminPhone(process.env.ADMIN_PHONE);
  const adminName = String(process.env.ADMIN_NAME || 'Super Admin').trim() || 'Super Admin';

  if (adminCount === 0) {
    if (!adminEmail || !adminPassword || !adminPhone) {
      console.warn('Admin seed skipped: set ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_PHONE to create the default super admin account.');
    } else if (process.env.ALLOW_AUTO_ADMIN_SEED !== 'true') {
      console.warn('Admin seed is disabled by default. To enable automatic admin creation set ALLOW_AUTO_ADMIN_SEED=true in environment or create admin manually using the tools/createAdmin.js script.');
    } else {
      await Admin.create({
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        phone: adminPhone,
        role: 'admin',
        permissions: [...FULL_ADMIN_PERMISSIONS],
        isActive: true
      });
    }
  }

  const existingAdmins = await Admin.find({ role: 'admin' }).select('+password');
  for (const existingAdmin of existingAdmins) {
    let shouldRepair = false;

    if (!existingAdmin.name) {
      existingAdmin.name = adminName;
      shouldRepair = true;
    }
    if (!existingAdmin.phone) {
      existingAdmin.phone = adminPhone || existingAdmin.phone;
      shouldRepair = true;
    }
    if (!existingAdmin.password || !/^\$2[aby]\$/.test(existingAdmin.password)) {
      if (adminPassword && process.env.ALLOW_AUTO_ADMIN_SEED === 'true') {
        existingAdmin.set('password', adminPassword);
        existingAdmin.markModified('password');
        shouldRepair = true;
      } else if (!existingAdmin.password) {
        console.warn(`Found admin ${existingAdmin.email} with missing password; automatic repair is disabled.`);
      }
    }
    if (!hasAllAdminPermissions(existingAdmin.permissions)) {
      existingAdmin.permissions = [...FULL_ADMIN_PERMISSIONS];
      existingAdmin.markModified('permissions');
      shouldRepair = true;
    }
    if (!existingAdmin.isActive) {
      existingAdmin.isActive = true;
      shouldRepair = true;
    }
    if (existingAdmin.role !== 'admin') {
      existingAdmin.role = 'admin';
      shouldRepair = true;
    }

    if (shouldRepair) {
      await existingAdmin.save();
    }
  }

  await seedCollection(Car, [
    {
      carName: 'Mercedes V-Class',
      image: 'https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1200&q=80',
      seatingCapacity: 6,
      category: 'Luxury Van',
      fuelType: 'Diesel',
      transmission: 'Automatic',
      pricePerDay: 18000,
      baseFare: 500,
      pricePerKm: 18,
      extraKmRate: 25,
      nightChargePercent: 10,
      driverAllowance: 500,
      includedKm: 300,
      availability: true,
      features: ['Leather seats', 'Captain seats', 'Ambient lighting', 'Premium AC']
    },
    {
      carName: 'Toyota Vellfire',
      image: 'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=1200&q=80',
      seatingCapacity: 6,
      category: 'Ultra Luxury',
      fuelType: 'Hybrid',
      transmission: 'Automatic',
      pricePerDay: 20000,
      baseFare: 700,
      pricePerKm: 25,
      extraKmRate: 30,
      nightChargePercent: 10,
      driverAllowance: 600,
      includedKm: 300,
      availability: true,
      features: ['Executive lounge', 'Captain recliners', 'Smart infotainment', 'Chauffeur focus']
    },
    {
      carName: 'Toyota Fortuner',
      image: 'https://images.unsplash.com/photo-1619767886558-efdc259cde1e?auto=format&fit=crop&w=1200&q=80',
      seatingCapacity: 7,
      category: 'SUV',
      fuelType: 'Diesel',
      transmission: 'Automatic',
      pricePerDay: 12000,
      baseFare: 700,
      pricePerKm: 25,
      extraKmRate: 30,
      nightChargePercent: 10,
      driverAllowance: 600,
      includedKm: 300,
      availability: true,
      features: ['High ground clearance', 'Spacious cabin', 'Tour-ready', 'Reliable performance']
    }
  ], 'carName');

  await seedCollection(Package, [
    {
      packageName: 'Local Package',
      image: 'https://images.unsplash.com/photo-1559767947-0d3a3b4be6e5?auto=format&fit=crop&w=1200&q=80',
      destinations: ['Lucknow City', 'Local Sightseeing'],
      duration: '8 Hours / 80 KM',
      price: 6500,
      inclusions: ['Driver allowance included', 'Local city travel', 'Standard waiting time'],
      exclusions: ['Extra KM', 'Extra Hour', 'Tolls', 'Parking'],
      description: 'Local city package for up to 8 hours and 80 KM.'
    },
    {
      packageName: 'Half Day Package',
      image: 'https://images.unsplash.com/photo-1559767947-0d3a3b4be6e5?auto=format&fit=crop&w=1200&q=80',
      destinations: ['Lucknow City', 'Quick Transfers'],
      duration: '4 Hours / 40 KM',
      price: 3500,
      inclusions: ['Driver allowance included', 'Quick city trip'],
      exclusions: ['Extra KM', 'Extra Hour', 'Tolls', 'Parking'],
      description: 'Short-duration local package for quick trips.'
    },
    {
      packageName: 'Airport Pickup / Drop',
      image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80',
      destinations: ['Airport', 'Hotel', 'City Center'],
      duration: 'One Way',
      price: 2500,
      inclusions: ['Pickup assistance', 'Luggage support', 'Driver wait time'],
      exclusions: ['Tolls', 'Parking'],
      description: 'Premium airport pickup and drop service with punctual chauffeur support.'
    },
    {
      packageName: 'Outstation Package',
      image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
      destinations: ['Ayodhya', 'Prayagraj', 'Varanasi', 'Delhi'],
      duration: '300 KM / Day',
      price: 8500,
      inclusions: ['Chauffeur', 'Fuel', 'Route planning', 'Driver allowance included'],
      exclusions: ['Tolls', 'Parking', 'State tax'],
      description: 'Ideal for intercity and spiritual tours with a luxury first approach.'
    },
    {
      packageName: 'Wedding / VIP Events',
      image: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80',
      destinations: ['Venue transfers', 'Guest movement'],
      duration: 'Custom',
      price: 12000,
      inclusions: ['Decor coordination', 'Priority dispatch', 'Multiple pickups'],
      exclusions: ['Extra waiting hours'],
      description: 'Premium event transport tailored for weddings and VIP occasions.'
    }
  ], 'packageName');

  await seedCollection(Route, [
    { from: 'Lucknow', to: 'Ayodhya', distance: '135 KM', estimatedTime: '3 hr', price: 9500 },
    { from: 'Lucknow', to: 'Prayagraj', distance: '200 KM', estimatedTime: '4.5 hr', price: 12500 },
    { from: 'Lucknow', to: 'Varanasi', distance: '315 KM', estimatedTime: '6 hr', price: 16500 },
    { from: 'Lucknow', to: 'Gorakhpur', distance: '275 KM', estimatedTime: '5.5 hr', price: 13500 },
    { from: 'Lucknow', to: 'Delhi', distance: '520 KM', estimatedTime: '8.5 hr', price: 28000 }
  ]);

  await seedCollection(Driver, [
    { driverName: 'Amit Kumar', phone: '9000000001', vehicleAssigned: 'Mercedes V-Class', licenseNumber: 'DL-2026-0001', availability: true, currentLocation: 'Lucknow' },
    { driverName: 'Rohit Verma', phone: '9000000002', vehicleAssigned: 'Toyota Fortuner', licenseNumber: 'DL-2026-0002', availability: true, currentLocation: 'Lucknow' }
  ], 'licenseNumber');

  await seedCollection(SiteSettings, [{
    businessName: 'RAM KRISHNA TOUR & TRAVELS',
    contactEmail: 'support@example.com',
    contactPhone: '8081181368',
    address: 'Lucknow, Uttar Pradesh',
    logoText: 'RK',
    billing: {
      gstin: '09ABCDE1234F1Z5',
      taxPercent: 5,
      upiId: 'rktravel@upi',
      bankAccountName: 'RAM KRISHNA TOUR & TRAVELS',
      bankAccountNumber: '000000000000',
      bankIfsc: 'BANK0000000',
      bankBranch: 'Lucknow Main',
      paymentLink: '',
      footerNote: 'Thank you for choosing our premium chauffeur and travel services.'
    },
    pricingSettings: {
      gstPercent: 5,
      nightChargePercent: 10,
      localPackagePrice: 6500,
      halfDayPrice: 3500,
      extraKmCharge: 28,
      extraHourCharge: 500,
      airportTransferMinCharge: 2500,
      airportTransferMaxCharge: 3500,
      outstationMinCharge: 8500,
      outstationMaxCharge: 10500,
      weddingVipCharge: 12000,
      driverAllowance: 0,
      waitingChargePerHour: 0,
      defaultIncludedKm: 80,
      defaultIncludedHours: 8,
      baseFare: 6500,
      pricePerKm: 28
    },
    homepage: {
      heroTitle: 'Travel in luxury, arrive in style',
      heroSubtitle: 'Premium rides. Trusted drivers. Memorable journeys.',
      bannerImage: '',
      testimonials: [
        { name: 'Aman', quote: 'Excellent service and on-time pickup.' },
        { name: 'Priya', quote: 'Premium vehicles and professional drivers.' }
      ],
      fleetHighlights: [
        { title: 'Premium Comfort', description: 'Luxury seats and smooth travel.' },
        { title: 'Trusted Drivers', description: 'Verified drivers with route expertise.' }
      ],
      seoTitle: 'Luxury Tour & Travels',
      seoDescription: 'Luxury car rental and tour booking platform'
    }
  }]);
}

module.exports = { seedDefaults };