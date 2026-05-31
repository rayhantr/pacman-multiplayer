import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  Player,
  GameState,
  ClientGameState,
  ClientPlayer,
  PowerUp,
  PowerUpType,
  EffectType,
  Role,
  Position,
  Direction,
  GhostColor,
  PacmanColor,
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from './types.js';
import { EFFECT_DURATION_MS, ITEM_SELF_EFFECT, PACMAN_POWERUPS, GHOST_POWERUPS } from './types.js';

type TypedServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

const MAX_PLAYERS = 5;
const GHOST_COLORS = ['red', 'pink', 'cyan', 'orange'] as const;
const PACMAN_COLORS = ['amber', 'lime', 'sky', 'rose', 'violet'] as const;

// Movement is discrete (one cell per accepted input). A per-player cooldown
// throttles moves and is the mechanism that makes the speed-boost power-up
// meaningful (and incidentally rate-limits move spam).
const BASE_MOVE_COOLDOWN_MS = 130;
const BOOSTED_MOVE_COOLDOWN_MS = 65;

// Two team pools now alternate on each spawn, so halve the interval to keep each
// team supplied at roughly the original one-item-per-30s cadence.
const POWER_UP_SPAWN_INTERVAL_MS = 15_000;
// How long an uncollected boost stays on the board before it vanishes. Team-gated
// items linger a little longer so the owning role has time to reach them.
const POWER_UP_LIFETIME_MS = 20_000;
// Cadence at which the power-up timer sweeps expired board boosts, expires player
// effects (so a phasing player can't get stranded in a wall by standing still),
// and periodically spawns new boosts.
const POWER_UP_TICK_MS = 1_000;

// Pac-Man's pellet-magnet vacuums every pellet within this Chebyshev radius.
const MAGNET_RADIUS = 2;

const PELLET_POINTS = 10;
const GHOST_EATEN_POINTS = 200;

export class GameManager {
  private readonly io: TypedServer;
  private readonly players = new Map<string, Player>();
  private gameState: GameState;
  private powerUpTimer: NodeJS.Timeout | null = null;
  // Stable game owner (first joiner): controls start/restart regardless of role.
  private hostId: string | null = null;
  private readonly roomId: string;
  private readonly notifyRoomsChanged: (() => void) | undefined;
  // Injectable RNG (defaults to Math.random) so power-up spawning is deterministic in tests.
  private readonly random: () => number;
  // Alternates the spawn pool (Pac-Man vs ghost) so neither team starves.
  private spawnCount = 0;

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

    // First player to join owns the room (controls start/restart) and defaults
    // to Pac-Man; everyone else defaults to ghost. All roles are re-pickable in
    // the lobby via set_role.
    const isPacman = this.players.size === 0;
    if (isPacman) {
      this.hostId = socket.id;
    }
    const role: 'pacman' | 'ghost' = isPacman ? 'pacman' : 'ghost';
    const spawnSlot = this.nextFreeSlot(role);
    const colors = this.colorForRole(role, spawnSlot);

    const player: Player = {
      id: socket.id,
      name,
      role,
      lobbyRole: role,
      ghostColor: colors.ghostColor,
      pacmanColor: colors.pacmanColor,
      spawnSlot,
      position: this.getSpawnPosition(role, spawnSlot),
      direction: 'right',
      speed: isPacman ? 2 : 1.8,
      powerUps: {},
      lastMoveAt: 0,
      isAlive: true,
    };

    this.players.set(socket.id, player);
    void socket.join(this.roomId);

    socket.emit('join_success', {
      player_id: socket.id,
      role: player.role,
      is_host: socket.id === this.hostId,
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

    // A frozen player (caught in an opponent's freeze) cannot move.
    if (player.powerUps.frozen) {
      return;
    }

    const now = Date.now();
    if (now - player.lastMoveAt < this.moveCooldownFor(player)) {
      return; // Throttled by the move cooldown.
    }

    const newPosition = this.calculateNewPosition(player.position, direction);
    // While phasing, walls are passable (board bounds still enforced).
    if (!this.isValidMove(newPosition, !!player.powerUps.phase)) {
      return;
    }

    player.position = newPosition;
    player.direction = direction;
    player.lastMoveAt = now;

    const posKey = `${newPosition.x},${newPosition.y}`;
    let pelletCollected = false;

    if (player.role === 'pacman') {
      if (this.gameState.pellets.has(posKey)) {
        this.gameState.pellets.delete(posKey);
        this.gameState.pelletsRemaining--;
        pelletCollected = true;

        const multiplier = player.powerUps.pellet_multiplier ? 2 : 1;
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

      // Pellet-magnet vacuums the surrounding ring (can also win the game).
      if (player.powerUps.magnet) {
        this.collectPelletsAround(player);
        if (this.gameState.isGameOver) {
          return;
        }
      }
    }

    // Power-up pickup: either role may collect, but only items owned by their team.
    const powerUp = this.gameState.powerUps.get(posKey);
    if (powerUp?.owner === player.role) {
      this.gameState.powerUps.delete(posKey);
      this.applyPowerUp(player, powerUp.type);
      this.io.to(this.roomId).emit('power_up_collected', {
        player_id: playerId,
        type: powerUp.type,
        position: posKey,
      });
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

  /** Let a waiting player toggle their lobby role (Pac-Man <-> ghost). */
  public handleSetRole(playerId: string, role: 'pacman' | 'ghost'): void {
    const player = this.players.get(playerId);
    if (!player || this.gameState.isStarted || this.gameState.isGameOver) {
      return; // Roles are only editable in the lobby.
    }
    if (player.role === role) {
      return;
    }

    const slot = this.nextFreeSlot(role);
    const colors = this.colorForRole(role, slot);
    player.role = role;
    player.lobbyRole = role;
    player.spawnSlot = slot;
    player.ghostColor = colors.ghostColor;
    player.pacmanColor = colors.pacmanColor;
    player.position = this.getSpawnPosition(role, slot);

    this.io.to(this.roomId).emit('player_role_changed', {
      player_id: playerId,
      role,
      ghostColor: player.ghostColor ?? null,
      pacmanColor: player.pacmanColor ?? null,
      can_start: this.canStartGame(),
    });
    this.notifyRoomsChanged?.();
  }

  public handleStartGame(playerId: string): void {
    if (playerId !== this.hostId) {
      return; // Only the host can start.
    }
    if (!this.canStartGame()) {
      this.io.to(this.roomId).emit('start_failed', {
        reason: 'Need at least 1 Pac-Man and 1 ghost to start.',
      });
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

    // Hand the room off to a remaining player if the host left, so the lobby
    // can still be started and (re)broadcast the start authority.
    if (playerId === this.hostId) {
      const next = this.players.values().next();
      this.hostId = next.done ? null : next.value.id;
    }

    // If the LAST Pac-Man leaves mid-game, the ghosts win. With multiple
    // Pac-Men, one leaving while others remain does not end the game.
    if (
      player.role === 'pacman' &&
      this.gameState.isStarted &&
      !this.gameState.isGameOver &&
      !this.hasPacman()
    ) {
      this.endGame('ghosts');
    }

    // If the room emptied, reset it so the next players get a fresh board.
    if (this.players.size === 0) {
      this.clearPowerUpTimer();
      this.gameState = this.initializeGameState();
      this.hostId = null;
      console.log('🔄 No players left, game reset');
    }

    this.notifyRoomsChanged?.();
  }

  public handleRestartGame(playerId: string): void {
    if (playerId !== this.hostId) {
      return; // Only the host can restart the game.
    }

    console.log('🔄 Restarting game...');

    this.clearPowerUpTimer();
    this.gameState = this.initializeGameState();

    // Restore each player to the role they chose in the lobby (undoing any
    // catch-conversions from the previous round) and re-derive slot/color.
    // Per-role counters keep slots unique regardless of iteration order.
    let pacmanSlot = 0;
    let ghostSlot = 0;
    this.players.forEach(p => {
      p.role = p.lobbyRole;
      const slot = p.role === 'pacman' ? pacmanSlot++ : ghostSlot++;
      const colors = this.colorForRole(p.role, slot);
      p.spawnSlot = slot;
      p.ghostColor = colors.ghostColor;
      p.pacmanColor = colors.pacmanColor;
      p.position = this.getSpawnPosition(p.role, slot);
      p.direction = 'right';
      p.powerUps = {};
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
      // Distinct corners/edges so multiple Pac-Men don't stack. Each candidate
      // is validated against the maze; fall back to {1,1} (guaranteed walkable
      // by the spawn-block clear at maze generation).
      // All verified-path cells (maze rule: wall where x%4==0&&y%4==0 or
      // x%6==0&&y%3==0), distinct from the ghost spawn cells.
      const pacmanSpawns: readonly Position[] = [
        { x: 1, y: 1 },
        { x: 1, y: 9 },
        { x: 9, y: 1 },
        { x: 17, y: 1 },
        { x: 9, y: 17 },
      ] as const;
      const candidate = pacmanSpawns[spawnSlot ?? 0] ?? { x: 1, y: 1 };
      return this.isValidMove(candidate) ? candidate : { x: 1, y: 1 };
    }

    const ghostSpawns: readonly Position[] = [
      { x: 18, y: 1 },
      { x: 1, y: 17 },
      { x: 18, y: 17 },
      { x: 9, y: 9 },
    ] as const;

    return ghostSpawns[spawnSlot ?? 0] ?? { x: 9, y: 9 };
  }

  /** Lowest spawn slot not currently used by a player of the given role. */
  private nextFreeSlot(role: 'pacman' | 'ghost'): number {
    const used = new Set<number>();
    for (const p of this.players.values()) {
      if (p.role === role && p.spawnSlot !== null) {
        used.add(p.spawnSlot);
      }
    }
    let slot = 0;
    while (used.has(slot)) {
      slot++;
    }
    return slot;
  }

  /** Color pair for a role+slot: one set, the other nulled. */
  private colorForRole(
    role: 'pacman' | 'ghost',
    slot: number
  ): { ghostColor: GhostColor | null; pacmanColor: PacmanColor | null } {
    return role === 'pacman'
      ? { pacmanColor: PACMAN_COLORS[slot] ?? null, ghostColor: null }
      : { ghostColor: GHOST_COLORS[slot] ?? null, pacmanColor: null };
  }

  private hasPacman(): boolean {
    for (const p of this.players.values()) {
      if (p.role === 'pacman') {
        return true;
      }
    }
    return false;
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

  private isValidMove(position: Position, phasing = false): boolean {
    const { x, y } = position;
    const maze = this.gameState.maze;

    if (y < 0 || y >= maze.length || x < 0 || x >= (maze[0]?.length ?? 0)) {
      return false; // Out of bounds — never passable, even while phasing.
    }

    return phasing || maze[y]?.[x] === 0; // 0 = path, 1 = wall
  }

  private moveCooldownFor(player: Player): number {
    return player.powerUps.speed ? BOOSTED_MOVE_COOLDOWN_MS : BASE_MOVE_COOLDOWN_MS;
  }

  /** First in-bounds walkable cell at/around a position (BFS over 4-neighbors). */
  private nearestWalkable(from: Position): Position | null {
    const seen = new Set<string>([`${from.x},${from.y}`]);
    const queue: Position[] = [from];
    while (queue.length) {
      const cell = queue.shift()!;
      if (this.isValidMove(cell)) {
        return cell;
      }
      for (const next of [
        { x: cell.x + 1, y: cell.y },
        { x: cell.x - 1, y: cell.y },
        { x: cell.x, y: cell.y + 1 },
        { x: cell.x, y: cell.y - 1 },
      ]) {
        const key = `${next.x},${next.y}`;
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(next);
        }
      }
    }
    return null;
  }

  /** Pellet-magnet: collect every pellet within Chebyshev radius of the Pac-Man. */
  private collectPelletsAround(pacman: Player): void {
    const multiplier = pacman.powerUps.pellet_multiplier ? 2 : 1;
    for (let dy = -MAGNET_RADIUS; dy <= MAGNET_RADIUS; dy++) {
      for (let dx = -MAGNET_RADIUS; dx <= MAGNET_RADIUS; dx++) {
        if (dx === 0 && dy === 0) {
          continue; // The current cell is handled by the direct pickup.
        }
        const key = `${pacman.position.x + dx},${pacman.position.y + dy}`;
        if (!this.gameState.pellets.has(key)) {
          continue;
        }
        this.gameState.pellets.delete(key);
        this.gameState.pelletsRemaining--;
        this.gameState.score += PELLET_POINTS * multiplier;
        this.io.to(this.roomId).emit('pellet_collected', {
          position: key,
          score: this.gameState.score,
          pellets_remaining: this.gameState.pelletsRemaining,
        });
        if (this.gameState.pelletsRemaining === 0) {
          this.endGame('pacman');
          return;
        }
      }
    }
  }

  private applyPowerUp(player: Player, type: PowerUpType): void {
    // The two freeze items don't grant a self-effect; they freeze the other team.
    if (type === 'pacman_freeze' || type === 'ghost_freeze') {
      const targetRole: Role = player.role === 'pacman' ? 'ghost' : 'pacman';
      const endTime = Date.now() + EFFECT_DURATION_MS.frozen;
      for (const target of this.players.values()) {
        if (target.role !== targetRole) {
          continue;
        }
        target.powerUps.frozen = { type: 'frozen', endTime };
        this.io.to(this.roomId).emit('effect_applied', {
          player_id: target.id,
          effect: 'frozen',
          endTime,
        });
      }
      return;
    }

    const effect = ITEM_SELF_EFFECT[type];
    if (!effect) {
      return; // Defensive: every non-freeze item maps to a self-effect.
    }
    const endTime = Date.now() + EFFECT_DURATION_MS[effect];
    player.powerUps[effect] = { type: effect, endTime };
    this.io.to(this.roomId).emit('effect_applied', {
      player_id: player.id,
      effect,
      endTime,
    });
  }

  /** Clear any timed effects that have elapsed, notifying clients. */
  private expireEffects(): void {
    const now = Date.now();

    for (const player of this.players.values()) {
      for (const key of Object.keys(player.powerUps) as EffectType[]) {
        const effect = player.powerUps[key];
        if (!effect || effect.endTime > now) {
          continue;
        }
        delete player.powerUps[key];

        // Phase ending while standing inside a wall: snap to the nearest walkable
        // cell so the player isn't stranded.
        if (key === 'phase' && !this.isValidMove(player.position)) {
          const safe = this.nearestWalkable(player.position);
          if (safe) {
            player.position = safe;
            this.io.to(this.roomId).emit('player_moved', {
              player_id: player.id,
              x: safe.x,
              y: safe.y,
              direction: player.direction,
              score: this.gameState.score,
              pellets_remaining: this.gameState.pelletsRemaining,
              pellet_collected: false,
            });
          }
        }

        this.io.to(this.roomId).emit('effect_expired', {
          player_id: player.id,
          effect: key,
        });
      }
    }
  }

  private countRole(role: Role): number {
    let count = 0;
    for (const p of this.players.values()) {
      if (p.role === role) {
        count++;
      }
    }
    return count;
  }

  private checkCollisions(): void {
    const players = Array.from(this.players.values());
    const pacmen = players.filter(p => p.role === 'pacman');
    if (pacmen.length === 0) {
      return;
    }
    const ghosts = players.filter(p => p.role === 'ghost');

    for (const pacman of pacmen) {
      for (const ghost of ghosts) {
        if (!this.arePositionsEqual(pacman.position, ghost.position)) {
          continue;
        }

        if (pacman.powerUps.invincibility) {
          // Pac-Man is invincible: the ghost is eaten and respawns at its slot.
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
          // Caught: this Pac-Man is converted into a ghost for the rest of the
          // round. Stop matching it (it is no longer a Pac-Man).
          this.convertToGhost(pacman);
          break;
        }
      }
    }

    // Ghosts win only once every Pac-Man has been converted away.
    if (!this.hasPacman()) {
      this.endGame('ghosts');
    }
  }

  /** Permanently turn a caught Pac-Man into a ghost (for the rest of the round). */
  private convertToGhost(player: Player): void {
    const slot = this.nextFreeSlot('ghost');
    player.role = 'ghost';
    player.spawnSlot = slot;
    player.ghostColor = GHOST_COLORS[slot] ?? null;
    player.pacmanColor = null;
    player.powerUps = {};
    player.position = this.getSpawnPosition('ghost', slot);

    this.io.to(this.roomId).emit('player_converted', {
      player_id: player.id,
      ghostColor: player.ghostColor,
      x: player.position.x,
      y: player.position.y,
    });
  }

  private arePositionsEqual(pos1: Position, pos2: Position): boolean {
    return pos1.x === pos2.x && pos1.y === pos2.y;
  }

  private startPowerUpTimer(): void {
    this.clearPowerUpTimer();
    this.spawnCount = 0;
    // One interval drives three jobs each tick: sweep expired board boosts, expire
    // player effects (so a phasing player can't get stranded in a wall by standing
    // still), and spawn a fresh boost every POWER_UP_SPAWN_INTERVAL_MS.
    let sinceSpawn = 0;
    this.powerUpTimer = setInterval(() => {
      this.sweepExpiredBoardPowerUps();
      this.expireEffects();
      sinceSpawn += POWER_UP_TICK_MS;
      if (sinceSpawn >= POWER_UP_SPAWN_INTERVAL_MS) {
        sinceSpawn = 0;
        this.spawnPowerUp();
      }
    }, POWER_UP_TICK_MS);
  }

  /** Remove board boosts that have sat uncollected past their lifetime. */
  private sweepExpiredBoardPowerUps(): void {
    const now = Date.now();
    for (const [posKey, powerUp] of this.gameState.powerUps) {
      if (now - powerUp.spawnTime >= POWER_UP_LIFETIME_MS) {
        this.gameState.powerUps.delete(posKey);
        this.io.to(this.roomId).emit('power_up_despawned', { position: posKey });
      }
    }
  }

  private clearPowerUpTimer(): void {
    if (this.powerUpTimer) {
      clearInterval(this.powerUpTimer);
      this.powerUpTimer = null;
    }
  }

  private spawnPowerUp(): void {
    // Alternate pools so neither team starves; fall back to the other pool if a
    // team is absent (e.g. the sole ghost disconnected while Pac-Men remain).
    const hasGhosts = this.countRole('ghost') > 0;
    const hasPacmen = this.countRole('pacman') > 0;
    let owner: Role = this.spawnCount % 2 === 0 ? 'pacman' : 'ghost';
    if (owner === 'ghost' && !hasGhosts) {
      owner = 'pacman';
    } else if (owner === 'pacman' && !hasPacmen) {
      owner = 'ghost';
    }
    this.spawnCount++;

    const pool = owner === 'pacman' ? PACMAN_POWERUPS : GHOST_POWERUPS;
    if (pool.length === 0) {
      return;
    }
    const type = pool[Math.floor(this.random() * pool.length)]!;

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

    const powerUp: PowerUp = { type, owner, position, spawnTime: Date.now() };
    this.gameState.powerUps.set(posKey, powerUp);

    this.io.to(this.roomId).emit('power_up_spawned', { type, owner, position: posKey });
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
    if (this.gameState.isStarted) {
      return false;
    }
    let pacmen = 0;
    let ghosts = 0;
    for (const p of this.players.values()) {
      if (p.role === 'pacman') {
        pacmen++;
      } else {
        ghosts++;
      }
    }
    return pacmen >= 1 && ghosts >= 1;
  }

  private getPlayerForClient(player: Player): ClientPlayer {
    return {
      id: player.id,
      name: player.name,
      role: player.role,
      ghostColor: player.ghostColor,
      pacmanColor: player.pacmanColor,
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
