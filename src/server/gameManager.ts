import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  Player,
  GameState,
  ClientGameState,
  PowerUp,
  Position,
  Direction,
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from './types.js';

export class GameManager {
  private readonly io: SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >;
  private readonly players = new Map<string, Player>();
  private gameState: GameState;
  private powerUpTimer: NodeJS.Timeout | null = null;
  private readonly roomId: string;

  constructor(io: SocketIOServer, roomId: string = 'game') {
    this.io = io;
    this.roomId = roomId;
    this.gameState = this.initializeGameState();
  }

  private initializeGameState(): GameState {
    const maze = this.generateMaze();
    const pellets = this.generatePellets(maze);

    return {
      isStarted: false,
      isGameOver: false,
      winner: null,
      score: 0,
      pelletsRemaining: pellets.size,
      maze,
      pellets,
      powerUps: new Map(),
      startTime: null,
    };
  }

  private generateMaze(): readonly (readonly number[])[] {
    const width = 20;
    const height = 19;
    const maze: number[][] = [];

    for (let y = 0; y < height; y++) {
      maze[y] = [];
      for (let x = 0; x < width; x++) {
        // Create walls around the border and some internal walls
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          maze[y][x] = 1; // Wall
        } else if ((x % 4 === 0 && y % 4 === 0) || (x % 6 === 0 && y % 3 === 0)) {
          maze[y][x] = 1; // Internal walls
        } else {
          maze[y][x] = 0; // Path
        }
      }
    }

    // Ensure spawn areas are clear
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        if (maze[y]) {
          maze[y][x] = 0;
        }
      }
    }

    return maze as readonly (readonly number[])[];
  }

  private generatePellets(maze: readonly (readonly number[])[]): Set<string> {
    const pellets = new Set<string>();

    for (let y = 0; y < maze.length; y++) {
      const row = maze[y];
      if (!row) continue;

      for (let x = 0; x < row.length; x++) {
        if (row[x] === 0) {
          // Path
          pellets.add(`${x},${y}`);
        }
      }
    }

    return pellets;
  }

  public handlePlayerJoin(socket: Socket, name: string): void {
    // Check if player has already joined
    if (this.players.has(socket.id)) {
      console.log(`Player ${socket.id} attempted to join again, ignoring duplicate request`);
      return;
    }

    if (this.players.size >= 5) {
      socket.emit('join_failed', { reason: 'Game is full' });
      return;
    }

    if (this.gameState.isStarted) {
      socket.emit('join_failed', { reason: 'Game already started' });
      return;
    }

    const role = this.players.size === 0 ? 'pacman' : 'ghost';
    const ghostColors = ['red', 'pink', 'cyan', 'orange'] as const;
    const ghostColor = role === 'ghost' ? (ghostColors[this.players.size - 1] ?? null) : null;

    const player: Player = {
      id: socket.id,
      name,
      role,
      ghostColor,
      position: this.getSpawnPosition(role),
      direction: 'right',
      speed: role === 'pacman' ? 2 : 1.8,
      powerUps: {
        speedBoost: null,
        invincibility: null,
        pelletMultiplier: null,
      },
      isAlive: true,
    };

    this.players.set(socket.id, player);
    socket.join(this.roomId);

    // Send success response to the joining player
    const clientGameState = this.getClientGameState();
    console.log('Sending join_success with game state:', JSON.stringify(clientGameState, null, 2));

    socket.emit('join_success', {
      player_id: socket.id,
      role: player.role,
      game_state: clientGameState,
    });

    // Notify all players about the new player
    this.io.to(this.roomId).emit('player_joined', {
      player: this.getPlayerForClient(player),
      can_start: this.canStartGame(),
    });

    console.log(`Player ${name} joined as ${role} (${socket.id})`);
  }

  public handlePlayerMove(playerId: string, direction: Direction): void {
    const player = this.players.get(playerId);
    if (!player || !this.gameState.isStarted || this.gameState.isGameOver) {
      return;
    }

    const newPosition = this.calculateNewPosition(player.position, direction);

    if (this.isValidMove(newPosition)) {
      player.position = newPosition;
      player.direction = direction;

      // Check for pellet collection (Pac-Man only)
      let pelletCollected = false;
      if (player.role === 'pacman') {
        const posKey = `${newPosition.x},${newPosition.y}`;
        if (this.gameState.pellets.has(posKey)) {
          this.gameState.pellets.delete(posKey);
          this.gameState.pelletsRemaining--;
          pelletCollected = true;

          const multiplier = player.powerUps.pelletMultiplier ? 2 : 1;
          this.gameState.score += 10 * multiplier;

          // Broadcast pellet collection
          this.io.to(this.roomId).emit('pellet_collected', {
            position: posKey,
            score: this.gameState.score,
            pellets_remaining: this.gameState.pelletsRemaining,
          });

          // Check win condition
          if (this.gameState.pelletsRemaining === 0) {
            this.endGame('pacman');
            return;
          }
        }
      }

      // Check for collisions
      this.checkCollisions();

      // Broadcast player movement
      this.io.to(this.roomId).emit('player_moved', {
        player_id: playerId,
        x: player.position.x,
        y: player.position.y,
        direction: player.direction,
        score: this.gameState.score,
        pellets_remaining: this.gameState.pelletsRemaining,
        pellet_collected: pelletCollected,
      });
    }
  }

  public handleStartGame(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || player.role !== 'pacman' || !this.canStartGame()) {
      return;
    }

    this.gameState.isStarted = true;
    this.gameState.startTime = Date.now();
    this.gameState.pelletsRemaining = this.gameState.pellets.size;

    this.io.to(this.roomId).emit('game_started');

    // Start power-up spawning
    this.startPowerUpTimer();

    console.log('🎮 Game started!');
  }

  public handlePlayerDisconnect(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    this.players.delete(playerId);

    this.io.to(this.roomId).emit('player_left', {
      player_id: playerId,
    });

    // If Pac-Man leaves, end the game
    if (player.role === 'pacman' && this.gameState.isStarted) {
      this.endGame('ghosts');
    }

    console.log(`👋 Player ${player.name} disconnected`);
  }

  public handleRestartGame(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player || player.role !== 'pacman') {
      return; // Only Pac-Man can restart the game
    }

    console.log('🔄 Restarting game...');

    // Reset game state
    this.gameState = this.initializeGameState();

    // Reset all players to starting positions
    this.players.forEach(p => {
      p.position = this.getSpawnPosition(p.role);
      p.direction = 'right';
      p.powerUps = {
        speedBoost: null,
        invincibility: null,
        pelletMultiplier: null,
      };
      p.isAlive = true;
    });

    // Clear any existing timers
    if (this.powerUpTimer) {
      clearInterval(this.powerUpTimer);
      this.powerUpTimer = null;
    }

    // Broadcast restart to all players
    this.io.to(this.roomId).emit('game_restarted', {
      game_state: this.getClientGameState(),
    });

    console.log('✅ Game restarted successfully');
  }

  public handleLeaveGame(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    console.log(`🚪 Player ${player.name} left the game`);

    // Remove player from game
    this.players.delete(playerId);

    // Broadcast player leaving
    this.io.to(this.roomId).emit('player_left', {
      player_id: playerId,
    });

    // If Pac-Man leaves and game is active, end the game
    if (player.role === 'pacman' && this.gameState.isStarted && !this.gameState.isGameOver) {
      this.endGame('ghosts');
    }

    // If no players left, reset the game
    if (this.players.size === 0) {
      this.gameState = this.initializeGameState();
      if (this.powerUpTimer) {
        clearInterval(this.powerUpTimer);
        this.powerUpTimer = null;
      }
      console.log('🔄 No players left, game reset');
    }
  }

  private getSpawnPosition(role: string): Position {
    if (role === 'pacman') {
      return { x: 1, y: 1 };
    }

    // Ghost spawn positions
    const ghostSpawns: readonly Position[] = [
      { x: 18, y: 1 },
      { x: 1, y: 17 },
      { x: 18, y: 17 },
      { x: 9, y: 9 },
    ] as const;

    const ghostIndex = this.players.size - 1;
    return ghostSpawns[ghostIndex] ?? { x: 9, y: 9 };
  }

  private calculateNewPosition(position: Position, direction: Direction): Position {
    const newPos = { ...position };

    switch (direction) {
      case 'up':
        newPos.y -= 1;
        break;
      case 'down':
        newPos.y += 1;
        break;
      case 'left':
        newPos.x -= 1;
        break;
      case 'right':
        newPos.x += 1;
        break;
      default:
        // Exhaustive check to ensure all directions are handled
        const _exhaustiveCheck: never = direction;
        return _exhaustiveCheck;
    }

    return newPos;
  }

  private isValidMove(position: Position): boolean {
    const { x, y } = position;
    const maze = this.gameState.maze;

    if (y < 0 || y >= maze.length || x < 0 || x >= (maze[0]?.length ?? 0)) {
      return false;
    }

    return maze[y]?.[x] === 0; // 0 = path, 1 = wall
  }

  private checkCollisions(): void {
    const pacman = Array.from(this.players.values()).find(p => p.role === 'pacman');
    if (!pacman) {
      return;
    }

    const ghosts = Array.from(this.players.values()).filter(p => p.role === 'ghost');

    for (const ghost of ghosts) {
      if (this.arePositionsEqual(pacman.position, ghost.position)) {
        if (pacman.powerUps.invincibility) {
          // Pac-Man is invincible, ghost is "eaten" (respawn)
          ghost.position = this.getSpawnPosition('ghost');
          this.gameState.score += 200;
        } else {
          // Pac-Man is caught
          this.endGame('ghosts');
          return;
        }
      }
    }
  }

  private arePositionsEqual(pos1: Position, pos2: Position): boolean {
    return pos1.x === pos2.x && pos1.y === pos2.y;
  }

  private startPowerUpTimer(): void {
    this.powerUpTimer = setInterval(() => {
      this.spawnPowerUp();
    }, 30000); // Every 30 seconds
  }

  private spawnPowerUp(): void {
    const powerUpTypes: readonly PowerUp['type'][] = [
      'speed_boost',
      'invincibility',
      'pellet_multiplier',
    ] as const;

    const type = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)]!;

    // Find random empty position
    const emptyPositions: Position[] = [];
    const maze = this.gameState.maze;

    for (let y = 0; y < maze.length; y++) {
      const row = maze[y];
      if (!row) continue;

      for (let x = 0; x < row.length; x++) {
        if (row[x] === 0) {
          emptyPositions.push({ x, y });
        }
      }
    }

    if (emptyPositions.length > 0) {
      const position = emptyPositions[Math.floor(Math.random() * emptyPositions.length)]!;
      const posKey = `${position.x},${position.y}`;

      const powerUp: PowerUp = {
        type,
        position,
        spawnTime: Date.now(),
      };

      this.gameState.powerUps.set(posKey, powerUp);

      this.io.to(this.roomId).emit('power_up_spawned', {
        type,
        position: posKey,
      });
    }
  }

  private endGame(winner: 'pacman' | 'ghosts'): void {
    this.gameState.isGameOver = true;
    this.gameState.winner = winner;

    if (this.powerUpTimer) {
      clearInterval(this.powerUpTimer);
      this.powerUpTimer = null;
    }

    this.io.to(this.roomId).emit('game_over', {
      winner,
      score: this.gameState.score,
    });

    console.log(`🏁 Game ended! Winner: ${winner}`);
  }

  private canStartGame(): boolean {
    return this.players.size >= 2 && !this.gameState.isStarted;
  }

  private getPlayerForClient(player: Player) {
    return {
      id: player.id,
      name: player.name,
      role: player.role,
      ghostColor: player.ghostColor,
      x: player.position.x,
      y: player.position.y,
      direction: player.direction,
    } as const;
  }

  private getClientGameState(): ClientGameState {
    return {
      players: Array.from(this.players.values()).map(player => this.getPlayerForClient(player)),
      maze: this.gameState.maze,
      pellets: Array.from(this.gameState.pellets),
      powerUps: Object.fromEntries(this.gameState.powerUps),
      score: this.gameState.score,
      pelletsRemaining: this.gameState.pelletsRemaining,
      canStart: this.canStartGame(),
    };
  }

  // Public methods for RoomManager
  public getPlayerCount(): number {
    return this.players.size;
  }

  public isGameStarted(): boolean {
    return this.gameState.isStarted;
  }

  public isGameOver(): boolean {
    return this.gameState.isGameOver;
  }
}
