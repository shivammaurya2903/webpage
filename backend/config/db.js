const dns = require('node:dns');
const mongoose = require('mongoose');

function parseDnsServers(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function connectWithUri(uri, options) {
  await mongoose.connect(uri, options);
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  const connectOptions = {
    autoIndex: process.env.NODE_ENV !== 'production',
    serverSelectionTimeoutMS: 15000
  };

  try {
    await connectWithUri(uri, connectOptions);
  } catch (error) {
    const isSrvDnsRefused = error?.code === 'ECONNREFUSED' && `${error?.hostname || ''}`.startsWith('_mongodb._tcp.');
    if (!isSrvDnsRefused) throw error;

    const fallbackUri = process.env.MONGODB_URI_FALLBACK;
    if (fallbackUri) {
      // eslint-disable-next-line no-console
      console.warn('MongoDB SRV lookup failed. Retrying with MONGODB_URI_FALLBACK.');
      await connectWithUri(fallbackUri, connectOptions);
      // eslint-disable-next-line no-console
      console.log('MongoDB Connected (fallback URI)');
      return;
    }

    const configuredDnsServers = parseDnsServers(process.env.DNS_SERVERS);
    const dnsServers = configuredDnsServers.length ? configuredDnsServers : ['1.1.1.1', '8.8.8.8'];
    dns.setServers(dnsServers);
    // eslint-disable-next-line no-console
    console.warn(`MongoDB SRV lookup failed. Retrying with DNS servers: ${dnsServers.join(', ')}`);
    await connectWithUri(uri, connectOptions);
  }

  // eslint-disable-next-line no-console
  console.log('MongoDB Connected');
}

module.exports = { connectDB };