import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { join, dirname, sep } from 'node:path';
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

const isProduction = process.env['NODE_ENV'] === 'production';
// In production the client is served same-origin from this server, so CORS is
// locked down (origin: false). In development the client is served by the Vite
// dev server, so we allow exactly that origin (never '*' together with
// credentials, which browsers reject).
const CLIENT_ORIGIN = process.env['CLIENT_ORIGIN'] ?? 'http://localhost:5173';
const corsOrigin: string | boolean = isProduction ? false : CLIENT_ORIGIN;

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
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';

// Security headers (helmet) with a CSP tuned for this app: same-origin assets,
// Google Fonts, the Socket.IO WebSocket, and audio playback.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        mediaSrc: ["'self'"],
      },
    },
  })
);

// Middleware
app.use(cors({ origin: corsOrigin, credentials: true }));
// gzip/deflate for compressible responses (HTML/CSS/JS/JSON/SVG/XML); already
// compressed media (png/mp3) is skipped by content-type. Mounted before the
// static middleware so all assets benefit — a direct Core Web Vitals win.
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve the built client (Vite output). Relative to the compiled server at
// dist/server, the client bundle lives at dist/client.
const clientDir = join(__dirname, '../client');
const ONE_YEAR_SECONDS = 31536000;
app.use(
  express.static(clientDir, {
    setHeaders: (res, filePath) => {
      // Vite-hashed bundles: the content hash is in the filename, so they can
      // be cached forever.
      if (filePath.includes(`${sep}assets${sep}`)) {
        res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
        return;
      }
      // The SPA shell: always revalidate so deploys go live immediately.
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
        return;
      }
      // SEO files: short-lived so crawler-facing changes propagate quickly.
      if (/(?:robots\.txt|sitemap\.xml|site\.webmanifest)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return;
      }
      // Un-hashed static assets (sprites, sounds, icons, og-image): long-lived
      // but revalidatable, since their names are stable across deploys.
      res.setHeader('Cache-Control', 'public, max-age=604800');
    },
  })
);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// '/' is served by express.static above (index.html, with the no-cache rule).

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

      const roomCode = data.roomCode ?? 'default'; // Default room if no code provided
      const role = data.role === 'pacman' || data.role === 'ghost' ? data.role : undefined;
      roomManager.joinRoomByCode(socket, data.name.trim(), roomCode, role);
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
      const role = data.role === 'pacman' || data.role === 'ghost' ? data.role : undefined;
      roomManager.createRoom(socket, data.name.trim(), data.roomName.trim(), role);
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

  // Handle lobby role selection
  socket.on('set_role', data => {
    try {
      if (data?.role !== 'pacman' && data?.role !== 'ghost') {
        return; // Ignore invalid roles
      }
      roomManager.handleSetRole(socket.id, data.role);
    } catch (error) {
      console.error('Error setting role:', error);
    }
  });

  // Handle lobby color selection
  socket.on('set_color', data => {
    try {
      if (typeof data?.color !== 'string') {
        return; // Ignore malformed input; the server also validates the palette.
      }
      roomManager.handleSetColor(socket.id, data.color);
    } catch (error) {
      console.error('Error setting color:', error);
    }
  });

  // Handle lobby map vote
  socket.on('vote_map', data => {
    try {
      if (typeof data?.mapId !== 'string') {
        return; // Ignore malformed input; the server validates the map id.
      }
      roomManager.handleVoteMap(socket.id, data.mapId);
    } catch (error) {
      console.error('Error voting for map:', error);
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
