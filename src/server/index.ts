import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from './roomManager.js';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// Initialize Socket.IO with proper typing
const io = new SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(server, {
  cors: {
    origin: process.env['NODE_ENV'] === 'production' ? false : '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';

// Middleware
app.use(
  cors({
    origin: process.env['NODE_ENV'] === 'production' ? false : '*',
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Serve static files
app.use(express.static(join(__dirname, '../../public')));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Serve the main HTML file
app.get('/', (_req, res) => {
  res.sendFile(join(__dirname, '../../public/index.html'));
});

// Initialize room manager
const roomManager = new RoomManager(io);

// Socket.IO connection handling with proper error handling
io.on('connection', socket => {
  console.log(`🎮 Client connected: ${socket.id}`);

  // Handle player joining by room code
  socket.on('join_game', data => {
    try {
      if (typeof data?.name !== 'string' || data.name.trim().length === 0) {
        socket.emit('join_failed', { reason: 'Invalid player name' });
        return;
      }

      const roomCode = data.roomCode || 'default'; // Default room if no code provided
      roomManager.joinRoomByCode(socket, data.name.trim(), roomCode);
    } catch (error) {
      console.error('Error handling player join:', error);
      socket.emit('join_failed', { reason: 'Server error occurred' });
    }
  });

  // Handle room creation
  socket.on('create_room', data => {
    try {
      if (typeof data?.name !== 'string' || data.name.trim().length === 0) {
        socket.emit('join_failed', { reason: 'Invalid player name' });
        return;
      }
      if (typeof data?.roomName !== 'string' || data.roomName.trim().length === 0) {
        socket.emit('join_failed', { reason: 'Invalid room name' });
        return;
      }
      roomManager.createRoom(socket, data.name.trim(), data.roomName.trim());
    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('join_failed', { reason: 'Failed to create room' });
    }
  });

  // Handle rooms list request
  socket.on('list_rooms', () => {
    try {
      const roomsList = roomManager.getRoomsList();
      socket.emit('rooms_list', { rooms: roomsList });
    } catch (error) {
      console.error('Error listing rooms:', error);
    }
  });

  // Handle player movement
  socket.on('player_move', data => {
    try {
      const validDirections: readonly string[] = ['up', 'down', 'left', 'right'];
      if (!data?.direction || !validDirections.includes(data.direction)) {
        return; // Silently ignore invalid directions
      }
      roomManager.handlePlayerMove(socket.id, data.direction);
    } catch (error) {
      console.error('Error handling player move:', error);
    }
  });

  // Handle game start
  socket.on('start_game', () => {
    try {
      roomManager.handleStartGame(socket.id);
    } catch (error) {
      console.error('Error starting game:', error);
    }
  });

  // Handle game restart
  socket.on('restart_game', () => {
    try {
      roomManager.handleRestartGame(socket.id);
    } catch (error) {
      console.error('Error restarting game:', error);
    }
  });

  // Handle leave game
  socket.on('leave_game', () => {
    try {
      roomManager.leaveRoom(socket.id);
    } catch (error) {
      console.error('Error leaving game:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', reason => {
    console.log(`👋 Client disconnected: ${socket.id}, reason: ${reason}`);
    try {
      roomManager.handlePlayerDisconnect(socket.id);
    } catch (error) {
      console.error('Error handling player disconnect:', error);
    }
  });

  // Handle connection errors
  socket.on('error', error => {
    console.error(`❌ Socket error for ${socket.id}:`, error);
  });
});

// Error handling for Socket.IO
io.engine.on('connection_error', err => {
  console.error('Connection error:', err.req);
  console.error('Error code:', err.code);
  console.error('Error message:', err.message);
  console.error('Error context:', err.context);
});

// Graceful shutdown handling
const gracefulShutdown = (): void => {
  console.log('🛑 Received shutdown signal, closing server gracefully...');

  server.close(err => {
    if (err) {
      console.error('❌ Error during server shutdown:', err);
      process.exit(1);
    }

    console.log('✅ Server closed successfully');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Listen for termination signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`🎮 Multiplayer Pac-Man server running!`);
  console.log(`🌐 Local: http://localhost:${PORT}`);
  console.log(`🌐 Network: http://${HOST}:${PORT}`);
  console.log(`🚀 Environment: ${process.env['NODE_ENV'] ?? 'development'}`);
});

export { io };
