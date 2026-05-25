const Car = require('../models/Car');
const Package = require('../models/Package');
const Route = require('../models/Route');
const Driver = require('../models/Driver');
const Admin = require('../models/Admin');
const SiteSettings = require('../models/SiteSettings');

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
  const adminSeed = {
    name: process.env.ADMIN_NAME || 'Site Admin',
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@12345',
    phone: process.env.ADMIN_PHONE || '9000000000',
    role: 'admin',
    isActive: true
  };

  const existingAdmin = await Admin.findOne({ email: adminSeed.email }).select('+password');
  if (!existingAdmin) {
    await Admin.create(adminSeed);
  } else {
    let shouldRepair = false;
    if (!existingAdmin.name) {
      existingAdmin.name = adminSeed.name;
      shouldRepair = true;
    }
    if (!existingAdmin.phone) {
      existingAdmin.phone = adminSeed.phone;
      shouldRepair = true;
    }
    if (!existingAdmin.password || !/^\$2[aby]\$/.test(existingAdmin.password)) {
      existingAdmin.set('password', adminSeed.password);
      existingAdmin.markModified('password');
      shouldRepair = true;
    }
    if (!existingAdmin.isActive) {
      existingAdmin.isActive = true;
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
      packageName: 'Airport Transfer',
      image: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80',
      destinations: ['Airport', 'Hotel', 'City Center'],
      duration: 'One Way',
      price: 2500,
      inclusions: ['Pickup assistance', 'Luggage support', 'Driver wait time'],
      exclusions: ['Tolls', 'Parking'],
      description: 'Premium airport pickup and drop service with punctual chauffeur support.'
    },
    {
      packageName: 'Luxury Outstation Tour',
      image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
      destinations: ['Ayodhya', 'Prayagraj', 'Varanasi', 'Delhi'],
      duration: '2-5 Days',
      price: 9500,
      inclusions: ['Chauffeur', 'Fuel', 'Route planning'],
      exclusions: ['Tolls', 'Parking', 'State tax'],
      description: 'Ideal for intercity and spiritual tours with a luxury first approach.'
    },
    {
      packageName: 'Wedding & VIP Event',
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