const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');

let io;

function getTokenFromHandshake(socket) {
  const authToken = socket.handshake.auth?.token;
  if (authToken) return String(authToken).replace(/^Bearer\s+/i, '').trim();

  const headerToken = socket.handshake.headers?.authorization;
  if (headerToken?.startsWith('Bearer ')) return headerToken.slice(7).trim();

  return null;
}

async function resolveSocketIdentity(socket) {
  if (!process.env.JWT_SECRET) return null;

  const token = getTokenFromHandshake(socket);
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const tokenType = decoded.type || decoded.role;
    const model = tokenType === 'admin' ? Admin : User;
    const actor = await model.findById(decoded.id || decoded.userId).lean();
    if (!actor || actor.isBlocked) return null;

    return {
      id: String(actor._id),
      role: actor.role || tokenType,
      name: actor.name || actor.adminName || actor.email || ''
    };
  } catch (_) {
    return null;
  }
}

function initSocket(server) {
  const origins = new Set([
    'https://webpage-96yf.onrender.com',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://localhost:5500',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000',
    'http://127.0.0.1:5500',
    'https://rkrishnatravels.netlify.app',
    ...(process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  ]);

  io = new Server(server, {
    cors: { origin: Array.from(origins), credentials: true }
  });

  io.engine.on('connection_error', (error) => {
    const origin = error?.req?.headers?.origin || 'no-origin';
    console.log(`[cors:socket] blocked origin: ${origin}`);
  });

  io.engine.on('initial_headers', (headers, req) => {
    const origin = req?.headers?.origin || 'no-origin';
    const allowed = !origin || origins.has(origin);
    console.log(`[cors:socket] ${allowed ? 'allowed' : 'blocked'} origin: ${origin}`);
  });

  io.use(async (socket, next) => {
    socket.data.identity = await resolveSocketIdentity(socket);
    next();
  });

  io.on('connection', (socket) => {
    socket.on('join:admin', () => {
      if (socket.data.identity?.role === 'admin') {
        socket.join('admins');
      }
    });

    socket.on('join:user', (userId) => {
      if (socket.data.identity?.role === 'customer' && userId && String(userId) === socket.data.identity.id) {
        socket.join(`user:${userId}`);
      }
    });

    socket.on('disconnect', () => undefined);
  });

  return io;
}

function emitToAdmins(eventName, payload) {
  io?.to('admins').emit(eventName, payload);
}

function emitToUser(userId, eventName, payload) {
  if (!userId) return;
  io?.to(`user:${userId}`).emit(eventName, payload);
}

module.exports = { initSocket, emitToAdmins, emitToUser };