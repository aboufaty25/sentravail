const { Server } = require('socket.io');
const env = require('./env');

let io = null;

// Socket.io shares the Express session: each logged-in user joins the room "u:<id>".
// If WebSockets are blocked by the host, Socket.io falls back to HTTP long-polling.
function initSocket(server, sessionMiddleware) {
  io = new Server(server, {
    serveClient: true,
    cors: { origin: env.APP_URL, credentials: true },
    pingInterval: 25000,
    pingTimeout: 20000,
  });
  io.engine.use(sessionMiddleware);
  io.on('connection', (socket) => {
    const userId = socket.request.session?.userId;
    if (!userId) {
      socket.disconnect(true);
      return;
    }
    socket.join(`u:${userId}`);
  });
  return io;
}

function emitToUser(userId, event, payload) {
  if (io) io.to(`u:${userId}`).emit(event, payload);
}

async function closeSocket() {
  if (io) await new Promise((resolve) => io.close(() => resolve()));
  io = null;
}

module.exports = { initSocket, emitToUser, closeSocket };
