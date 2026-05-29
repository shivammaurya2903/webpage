const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
require('dotenv').config();

const orsApiKey = process.env.ORS_API_KEY || process.env.OPENROUTESERVICE_API_KEY || '';
if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line no-console
  console.log(`[config] OpenRouteService API key ${orsApiKey ? 'loaded' : 'missing'}`);
}

const { connectDB } = require('./config/db');
const { initSocket } = require('./config/socket');
const { notFound, errorHandler } = require('./middleware/errorHandlers');
const { seedDefaults } = require('./utils/seedDefaults');

const authRoutes = require('./routes/authRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const fareRoutes = require('./routes/fareRoutes');
const carRoutes = require('./routes/carRoutes');
const packageRoutes = require('./routes/packageRoutes');
const routeRoutes = require('./routes/routeRoutes');
const driverRoutes = require('./routes/driverRoutes');
const contactRoutes = require('./routes/contactRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
initSocket(server);

const frontendPath = path.resolve(__dirname, '../frontend');
const adminPath = path.resolve(__dirname, '../frontend/admin');
const uploadsPath = path.resolve(__dirname, './uploads');
const defaultAllowedOrigins = [
  'https://webpage-96yf.onrender.com',
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5500',
  'https://rkrishnatravels.netlify.app'
];
const corsOrigins = new Set([
  ...defaultAllowedOrigins,
  ...(process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (corsOrigins.has(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && origin === 'null') return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return true;
  }
  return false;
}

function logOriginCheck(origin, allowed, source = 'http') {
  const label = origin || 'no-origin';
  const prefix = allowed ? 'allowed' : 'blocked';
  console.log(`[cors:${source}] ${prefix} origin: ${label}`);
}

const corsOptions = {
  origin(origin, callback) {
    const allowed = isAllowedOrigin(origin);
    logOriginCheck(origin, allowed, 'http');

    if (allowed) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin ${origin}`));
  },
  credentials: true
};

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      styleSrc: ["'self'", 'https:'],
      fontSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'", 'https:'],
      connectSrc: ["'self'", 'http:', 'https:', 'ws:', 'wss:']
    }
  }
}));
app.use(compression());
app.use(cookieParser());
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());
app.use(hpp());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.static(frontendPath));
app.use('/frontend', express.static(frontendPath));
app.use('/admin', express.static(adminPath));
app.use('/uploads', (req, res, next) => {
  // Prevent content-type sniffing and clickjacking for user-uploaded files
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}, express.static(uploadsPath));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'luxury-travel-booking-api', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/fare', fareRoutes);
app.use('/api/cars', carRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/admin', adminRoutes);

app.get('/admin*', (req, res) => {
  res.sendFile(path.join(adminPath, 'index.html'));
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  return res.sendFile(path.join(frontendPath, 'index.html'));
});

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  await seedDefaults();
  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.error(`Port ${PORT} is already in use. Update PORT in backend/.env or stop the conflicting process.`);
      process.exit(1);
    }

    // eslint-disable-next-line no-console
    console.error('Server listen error:', error);
    process.exit(1);
  });

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', error);
  process.exit(1);
});