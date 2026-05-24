const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri, {
    autoIndex: process.env.NODE_ENV !== 'production'
  });
}

module.exports = { connectDB };