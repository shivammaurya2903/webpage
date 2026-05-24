const Car = require('../models/Car');
const Package = require('../models/Package');
const Route = require('../models/Route');
const Driver = require('../models/Driver');

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
  await seedCollection(Car, [
    {
      carName: 'Mercedes V-Class',
      image: 'https://images.unsplash.com/photo-1542362567-b07e54358753?auto=format&fit=crop&w=1200&q=80',
      seatingCapacity: 6,
      category: 'Luxury Van',
      fuelType: 'Diesel',
      transmission: 'Automatic',
      pricePerDay: 18000,
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
}

module.exports = { seedDefaults };