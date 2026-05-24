const { Server } = require('socket.io');

let io;

function initSocket(server) {
  const origins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  io = new Server(server, {
    cors: { origin: origins, credentials: true }
  });

  io.on('connection', (socket) => {
    socket.on('join:admin', () => socket.join('admins'));
    socket.on('join:user', (userId) => {
      if (userId) socket.join(`user:${userId}`);
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