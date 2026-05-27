/**
 * Shared domain and socket-contract types.
 *
 * Single source of truth imported by BOTH the server (`src/server`) and the
 * client (`src/client`). Keeping the Socket.IO event maps here means the wire
 * contract is type-checked on both ends and can never drift.
 */

export interface Position {
  readonly x: number;
  readonly y: number;
}

export type PowerUpType = 'speed_boost' | 'invincibility' | 'pellet_multiplier';

export type Direction = 'up' | 'down' | 'left' | 'right';

export type GhostColor = 'red' | 'pink' | 'cyan' | 'orange';

/** An active, time-limited effect applied to a player after collecting a power-up. */
export interface PowerUpEffect {
  readonly type: PowerUpType;
  readonly endTime: number;
}

export interface PlayerPowerUps {
  speedBoost: PowerUpEffect | null;
  invincibility: PowerUpEffect | null;
  pelletMultiplier: PowerUpEffect | null;
}

/** Server-side authoritative player record. */
export interface Player {
  readonly id: string;
  readonly name: string;
  readonly role: 'pacman' | 'ghost';
  readonly ghostColor?: GhostColor | null;
  /** Index of the ghost spawn slot (0-3); null for Pac-Man. Used for respawning. */
  readonly spawnSlot: number | null;
  position: Position;
  direction: Direction;
  readonly speed: number;
  powerUps: PlayerPowerUps;
  /** Epoch ms of the last accepted move; drives the server-side move cooldown. */
  lastMoveAt: number;
  isAlive: boolean;
}

/** A power-up sitting on the board waiting to be collected. */
export interface PowerUp {
  readonly type: PowerUpType;
  readonly position: Position;
  readonly spawnTime: number;
}

/** Server-side authoritative game state (contains non-serializable Set/Map). */
export interface GameState {
  isStarted: boolean;
  isGameOver: boolean;
  winner: 'pacman' | 'ghosts' | null;
  score: number;
  pelletsRemaining: number;
  readonly maze: readonly (readonly number[])[];
  pellets: Set<string>;
  powerUps: Map<string, PowerUp>;
  startTime: number | null;
}

/** Network-serializable view of a player sent to clients. */
export interface ClientPlayer {
  readonly id: string;
  readonly name: string;
  readonly role: 'pacman' | 'ghost';
  readonly ghostColor?: GhostColor | null | undefined;
  readonly x: number;
  readonly y: number;
  readonly direction: Direction;
}

/** Network-serializable view of game state sent to clients (arrays/records, not Set/Map). */
export interface ClientGameState {
  readonly players: readonly ClientPlayer[];
  readonly maze: readonly (readonly number[])[];
  readonly pellets: readonly string[];
  readonly powerUps: Readonly<Record<string, PowerUp>>;
  readonly score: number;
  readonly pelletsRemaining: number;
  readonly canStart: boolean;
}

export interface RoomInfo {
  readonly id: string;
  readonly name: string;
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly isStarted: boolean;
  readonly isGameOver: boolean;
}

/** Events the server emits to clients. */
export interface ServerToClientEvents {
  join_success: (data: {
    readonly player_id: string;
    readonly role: string;
    readonly game_state: ClientGameState;
  }) => void;
  join_failed: (data: { readonly reason: string }) => void;
  player_joined: (data: { readonly player: ClientPlayer; readonly can_start: boolean }) => void;
  player_left: (data: { readonly player_id: string }) => void;
  game_started: () => void;
  player_moved: (data: {
    readonly player_id: string;
    readonly x: number;
    readonly y: number;
    readonly direction: Direction;
    readonly score: number;
    readonly pellets_remaining: number;
    readonly pellet_collected: boolean;
  }) => void;
  pellet_collected: (data: {
    readonly position: string;
    readonly score: number;
    readonly pellets_remaining: number;
  }) => void;
  power_up_spawned: (data: { readonly type: PowerUpType; readonly position: string }) => void;
  power_up_collected: (data: {
    readonly player_id: string;
    readonly type: PowerUpType;
    readonly position: string;
  }) => void;
  power_up_expired: (data: { readonly player_id: string; readonly type: PowerUpType }) => void;
  game_over: (data: { readonly winner: string; readonly score: number }) => void;
  game_restarted: (data: { readonly game_state: ClientGameState }) => void;
  rooms_list: (data: { readonly rooms: readonly RoomInfo[] }) => void;
  room_created: (data: { readonly roomId: string; readonly roomName: string }) => void;
}

/** Events clients emit to the server. */
export interface ClientToServerEvents {
  join_game: (data: { readonly name: string; readonly roomCode?: string }) => void;
  create_room: (data: { readonly name: string; readonly roomName: string }) => void;
  list_rooms: () => void;
  player_move: (data: { readonly direction: Direction }) => void;
  start_game: () => void;
  restart_game: () => void;
  leave_game: () => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  readonly userId?: string;
  readonly userName?: string;
}
