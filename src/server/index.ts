import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { GameManager } from './gameManager';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = parseInt(process.env.PORT || '3000', 10);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// Initialize game manager
const gameManager = new GameManager(io);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Handle player joining
  socket.on('join_game', (data: { name: string }) => {
    gameManager.handlePlayerJoin(socket, data.name);
  });
  
  // Handle player movement
  socket.on('player_move', (data: { direction: 'up' | 'down' | 'left' | 'right' }) => {
    gameManager.handlePlayerMove(socket.id, data.direction);
  });
  
  // Handle game start
  socket.on('start_game', () => {
    gameManager.handleStartGame(socket.id);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    gameManager.handlePlayerDisconnect(socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Multiplayer Pac-Man server running on port ${PORT}`);
  console.log(`🌐 Open http://localhost:${PORT} to play!`);
});

export { io };

