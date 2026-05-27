import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  Player,
  GameState,
  ClientGameState,
  ClientPlayer,
  PowerUp,
  PowerUpType,
  Position,
  Direction,
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from './types.js';

type TypedServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

const MAX_PLAYERS = 5;
const GHOST_COLORS = ['red', 'pink', 'cyan', 'orange'] as const;

// Movement is discrete (one cell per accepted input). A per-player cooldown
// throttles moves and is the mechanism that makes the speed-boost power-up
// meaningful (and incidentally rate-limits move spam).
const BASE_MOVE_COOLDOWN_MS = 130;
const BOOSTED_MOVE_COOLDOWN_MS = 65;

const POWER_UP_SPAWN_INTERVAL_MS = 30_000;
const POWER_UP_DURATION_MS: Record<PowerUpType, number> = {
  speed_boost: 10_000,
  invincibility: 5_000,
  pellet_multiplier: 10_000,
};

const PELLET_POINTS = 10;
const GHOST_EATEN_POINTS = 200;

export class GameManager {
  private readonly io: TypedServer;
  private readonly players = new Map<string, Player>();
  private gameState: GameState;
  private powerUpTimer: NodeJS.Timeout | null = null;
  private readonly roomId: string;
  private readonly notifyRoomsChanged: (() => void) | undefined;
  // Injectable RNG (defaults to Math.random) so power-up spawning is deterministic in tests.
  private readonly random: () => number;

  constructor(
    io: SocketIOServer,
    roomId: string = 'game',
    notifyRoomsChanged?: () => void,
    random: () => number = Math.random
  ) {
    this.io = io as TypedServer;
    this.roomId = roomId;
    this.notifyRoomsChanged = notifyRoomsChanged;
    this.random = random;
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
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          maze[y]![x] = 1; // Border wall
        } else if ((x % 4 === 0 && y % 4 === 0) || (x % 6 === 0 && y % 3 === 0)) {
          maze[y]![x] = 1; // Internal wall
        } else {
          maze[y]![x] = 0; // Path
        }
      }
    }

    // Ensure spawn areas are clear
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        if (maze[y]) {
          maze[y]![x] = 0;
        }
      }
    }

    return maze as readonly (readonly number[])[];
  }

  private generatePellets(maze: readonly (readonly number[])[]): Set<string> {
    const pellets = new Set<string>();

    for (let y = 0; y < maze.length; y++) {
      const row = maze[y];
      if (!row) {
        continue;
      }
      for (let x = 0; x < row.length; x++) {
        if (row[x] === 0) {
          pellets.add(`${x},${y}`);
        }
      }
    }

    return pellets;
  }

  public handlePlayerJoin(socket: Socket, name: string): void {
    if (this.players.has(socket.id)) {
      console.log(`Player ${socket.id} attempted to join again, ignoring duplicate request`);
      return;
    }

    if (this.players.size >= MAX_PLAYERS) {
      socket.emit('join_failed', { reason: 'Game is full' });
      return;
    }

    if (this.gameState.isStarted) {
      socket.emit('join_failed', { reason: 'Game already started' });
      return;
    }

    const isPacman = this.players.size === 0;
    const role = isPacman ? 'pacman' : 'ghost';
    const spawnSlot = isPacman ? null : this.players.size - 1;
    const ghostColor = isPacman ? null : (GHOST_COLORS[spawnSlot!] ?? null);

    const player: Player = {
      id: socket.id,
      name,
      role,
      ghostColor,
      spawnSlot,
      position: this.getSpawnPosition(role, spawnSlot),
      direction: 'right',
      speed: isPacman ? 2 : 1.8,
      powerUps: {
        speedBoost: null,
        invincibility: null,
        pelletMultiplier: null,
      },
      lastMoveAt: 0,
      isAlive: true,
    };

    this.players.set(socket.id, player);
    void socket.join(this.roomId);

    socket.emit('join_success', {
      player_id: socket.id,
      role: player.role,
      game_state: this.getClientGameState(),
    });

    this.io.to(this.roomId).emit('player_joined', {
      player: this.getPlayerForClient(player),
      can_start: this.canStartGame(),
    });

    console.log(`Player ${name} joined as ${role} (${socket.id})`);
    this.notifyRoomsChanged?.();
  }

  public handlePlayerMove(playerId: string, direction: Direction): void {
    const player = this.players.get(playerId);
    if (!player || !this.gameState.isStarted || this.gameState.isGameOver) {
      return;
    }

    // Drop any effects that have timed out before evaluating this move.
    this.expireEffects();

    const now = Date.now();
    if (now - player.lastMoveAt < this.moveCooldownFor(player)) {
      return; // Throttled by the move cooldown.
    }

    const newPosition = this.calculateNewPosition(player.position, direction);
    if (!this.isValidMove(newPosition)) {
      return;
    }

    player.position = newPosition;
    player.direction = direction;
    player.lastMoveAt = now;

    let pelletCollected = false;
    if (player.role === 'pacman') {
      const posKey = `${newPosition.x},${newPosition.y}`;

      if (this.gameState.pellets.has(posKey)) {
        this.gameState.pellets.delete(posKey);
        this.gameState.pelletsRemaining--;
        pelletCollected = true;

        const multiplier = player.powerUps.pelletMultiplier ? 2 : 1;
        this.gameState.score += PELLET_POINTS * multiplier;

        this.io.to(this.roomId).emit('pellet_collected', {
          position: posKey,
          score: this.gameState.score,
          pellets_remaining: this.gameState.pelletsRemaining,
        });

        if (this.gameState.pelletsRemaining === 0) {
          this.endGame('pacman');
          return;
        }
      }

      // Power-up pickup (Pac-Man only).
      const powerUp = this.gameState.powerUps.get(posKey);
      if (powerUp) {
        this.gameState.powerUps.delete(posKey);
        this.applyPowerUp(player, powerUp.type);
        this.io.to(this.roomId).emit('power_up_collected', {
          player_id: playerId,
          type: powerUp.type,
          position: posKey,
        });
      }
    }

    this.checkCollisions();
    if (this.gameState.isGameOver) {
      return;
    }

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

  public handleStartGame(playerId: string): void {
    const player = this.players.get(playerId);
    if (player?.role !== 'pacman' || !this.canStartGame()) {
      return;
    }

    this.gameState.isStarted = true;
    this.gameState.startTime = Date.now();
    this.gameState.pelletsRemaining = this.gameState.pellets.size;

    this.io.to(this.roomId).emit('game_started');
    this.startPowerUpTimer();

    console.log('🎮 Game started!');
    this.notifyRoomsChanged?.();
  }

  public handlePlayerDisconnect(playerId: string): void {
    this.removePlayer(playerId, true);
  }

  public handleLeaveGame(playerId: string): void {
    this.removePlayer(playerId, false);
  }

  /** Single code path for both explicit leave and disconnect. */
  private removePlayer(playerId: string, dueToDisconnect: boolean): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    this.players.delete(playerId);
    this.io.to(this.roomId).emit('player_left', { player_id: playerId });

    console.log(
      dueToDisconnect
        ? `👋 Player ${player.name} disconnected`
        : `🚪 Player ${player.name} left the game`
    );

    // If Pac-Man leaves mid-game, the ghosts win.
    if (player.role === 'pacman' && this.gameState.isStarted && !this.gameState.isGameOver) {
      this.endGame('ghosts');
    }

    // If the room emptied, reset it so the next players get a fresh board.
    if (this.players.size === 0) {
      this.clearPowerUpTimer();
      this.gameState = this.initializeGameState();
      console.log('🔄 No players left, game reset');
    }

    this.notifyRoomsChanged?.();
  }

  public handleRestartGame(playerId: string): void {
    const player = this.players.get(playerId);
    if (player?.role !== 'pacman') {
      return; // Only Pac-Man can restart the game.
    }

    console.log('🔄 Restarting game...');

    this.clearPowerUpTimer();
    this.gameState = this.initializeGameState();

    this.players.forEach(p => {
      p.position = this.getSpawnPosition(p.role, p.spawnSlot);
      p.direction = 'right';
      p.powerUps = { speedBoost: null, invincibility: null, pelletMultiplier: null };
      p.lastMoveAt = 0;
      p.isAlive = true;
    });

    this.io.to(this.roomId).emit('game_restarted', {
      game_state: this.getClientGameState(),
    });

    console.log('✅ Game restarted successfully');
    this.notifyRoomsChanged?.();
  }

  private getSpawnPosition(role: 'pacman' | 'ghost', spawnSlot: number | null): Position {
    if (role === 'pacman') {
      return { x: 1, y: 1 };
    }

    const ghostSpawns: readonly Position[] = [
      { x: 18, y: 1 },
      { x: 1, y: 17 },
      { x: 18, y: 17 },
      { x: 9, y: 9 },
    ] as const;

    return ghostSpawns[spawnSlot ?? 0] ?? { x: 9, y: 9 };
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
      default: {
        const _exhaustiveCheck: never = direction;
        return _exhaustiveCheck;
      }
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

  private moveCooldownFor(player: Player): number {
    return player.powerUps.speedBoost ? BOOSTED_MOVE_COOLDOWN_MS : BASE_MOVE_COOLDOWN_MS;
  }

  private applyPowerUp(player: Player, type: PowerUpType): void {
    const endTime = Date.now() + POWER_UP_DURATION_MS[type];
    switch (type) {
      case 'speed_boost':
        player.powerUps.speedBoost = { type, endTime };
        break;
      case 'invincibility':
        player.powerUps.invincibility = { type, endTime };
        break;
      case 'pellet_multiplier':
        player.powerUps.pelletMultiplier = { type, endTime };
        break;
      default: {
        const _exhaustiveCheck: never = type;
        return _exhaustiveCheck;
      }
    }
  }

  /** Clear any timed effects that have elapsed, notifying clients. */
  private expireEffects(): void {
    const now = Date.now();
    const keys = ['speedBoost', 'invincibility', 'pelletMultiplier'] as const;

    for (const player of this.players.values()) {
      for (const key of keys) {
        const effect = player.powerUps[key];
        if (effect && effect.endTime <= now) {
          player.powerUps[key] = null;
          this.io.to(this.roomId).emit('power_up_expired', {
            player_id: player.id,
            type: effect.type,
          });
        }
      }
    }
  }

  private checkCollisions(): void {
    const players = Array.from(this.players.values());
    const pacman = players.find(p => p.role === 'pacman');
    if (!pacman) {
      return;
    }

    const ghosts = players.filter(p => p.role === 'ghost');

    for (const ghost of ghosts) {
      if (!this.arePositionsEqual(pacman.position, ghost.position)) {
        continue;
      }

      if (pacman.powerUps.invincibility) {
        // Pac-Man is invincible: the ghost is eaten and respawns at its own slot.
        ghost.position = this.getSpawnPosition('ghost', ghost.spawnSlot);
        this.gameState.score += GHOST_EATEN_POINTS;

        this.io.to(this.roomId).emit('player_moved', {
          player_id: ghost.id,
          x: ghost.position.x,
          y: ghost.position.y,
          direction: ghost.direction,
          score: this.gameState.score,
          pellets_remaining: this.gameState.pelletsRemaining,
          pellet_collected: false,
        });
      } else {
        this.endGame('ghosts');
        return;
      }
    }
  }

  private arePositionsEqual(pos1: Position, pos2: Position): boolean {
    return pos1.x === pos2.x && pos1.y === pos2.y;
  }

  private startPowerUpTimer(): void {
    this.clearPowerUpTimer();
    this.powerUpTimer = setInterval(() => {
      this.spawnPowerUp();
    }, POWER_UP_SPAWN_INTERVAL_MS);
  }

  private clearPowerUpTimer(): void {
    if (this.powerUpTimer) {
      clearInterval(this.powerUpTimer);
      this.powerUpTimer = null;
    }
  }

  private spawnPowerUp(): void {
    const powerUpTypes: readonly PowerUpType[] = [
      'speed_boost',
      'invincibility',
      'pellet_multiplier',
    ];

    const type = powerUpTypes[Math.floor(this.random() * powerUpTypes.length)]!;

    const emptyPositions: Position[] = [];
    const maze = this.gameState.maze;

    for (let y = 0; y < maze.length; y++) {
      const row = maze[y];
      if (!row) {
        continue;
      }
      for (let x = 0; x < row.length; x++) {
        if (row[x] === 0) {
          emptyPositions.push({ x, y });
        }
      }
    }

    if (emptyPositions.length === 0) {
      return;
    }

    const position = emptyPositions[Math.floor(this.random() * emptyPositions.length)]!;
    const posKey = `${position.x},${position.y}`;

    const powerUp: PowerUp = { type, position, spawnTime: Date.now() };
    this.gameState.powerUps.set(posKey, powerUp);

    this.io.to(this.roomId).emit('power_up_spawned', { type, position: posKey });
  }

  private endGame(winner: 'pacman' | 'ghosts'): void {
    this.gameState.isGameOver = true;
    this.gameState.winner = winner;
    this.clearPowerUpTimer();

    this.io.to(this.roomId).emit('game_over', {
      winner,
      score: this.gameState.score,
    });

    console.log(`🏁 Game ended! Winner: ${winner}`);
    this.notifyRoomsChanged?.();
  }

  private canStartGame(): boolean {
    return this.players.size >= 2 && !this.gameState.isStarted;
  }

  private getPlayerForClient(player: Player): ClientPlayer {
    return {
      id: player.id,
      name: player.name,
      role: player.role,
      ghostColor: player.ghostColor,
      x: player.position.x,
      y: player.position.y,
      direction: player.direction,
    };
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

  // Public accessors for RoomManager
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
