const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '../../socket_debug.log');
function logDebug(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logPath, line);
}

let io;

module.exports = {
  init: (httpServer, allowedOrigins) => {
    logDebug('Initializing Socket.io...');
    io = socketIo(httpServer, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['polling', 'websocket'],
      allowUpgrades: true
    });

    io.on('connection', (socket) => {
      logDebug(`Client connected: ${socket.id}`);

      // Client can join a room for a specific zone if we want, or just listen globally.
      socket.on('join_zone', (zoneId) => {
        socket.join(zoneId);
        logDebug(`Client ${socket.id} joined zone: ${zoneId}`);
      });

      socket.on('leave_zone', (zoneId) => {
        socket.leave(zoneId);
        logDebug(`Client ${socket.id} left zone: ${zoneId}`);
      });

      socket.on('join_user', (userId) => {
        socket.join(`user_${userId}`);
        logDebug(`Client ${socket.id} joined user room: user_${userId}`);
      });

      socket.on('leave_user', (userId) => {
        socket.leave(`user_${userId}`);
        logDebug(`Client ${socket.id} left user room: user_${userId}`);
      });

      socket.on('disconnect', () => {
        logDebug(`Client disconnected: ${socket.id}`);
      });
    });

    return io;
  },

  getIO: () => {
    if (!io) {
      logDebug('getIO called but io is not initialized!');
      throw new Error('Socket.io not initialized!');
    }
    return io;
  },

  /**
   * Emits an ad update for a specific zone.
   * Clients listening to this zone will receive the new ad content (or fallback).
   */
  emitAdUpdate: (zoneId, adData) => {
    if (io) {
      io.to(zoneId).emit('activeAdUpdated', { zoneId, adData });
      logDebug(`Emitted activeAdUpdated for zone: ${zoneId}`);
    }
  },

  /**
   * Emits a new coupon notification to a specific user.
   */
  emitCouponToUser: (userId, couponData) => {
    if (io) {
      io.to(`user_${userId}`).emit('new_coupon', couponData);
      logDebug(`Emitted new_coupon to user room: user_${userId}`);
    } else {
      logDebug(`emitCouponToUser failed: io is not initialized!`);
    }
  }
};
