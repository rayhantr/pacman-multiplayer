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

export type Role = 'pacman' | 'ghost';

/**
 * Collectible board items. Each belongs to exactly one team's set (see
 * {@link POWERUP_OWNER}); only that role can pick it up — the other walks over it.
 */
export type PowerUpType =
  // Pac-Man set
  | 'speed_boost'
  | 'invincibility'
  | 'pellet_multiplier'
  | 'pellet_magnet'
  | 'pacman_freeze'
  | 'pacman_phase'
  // Ghost set
  | 'ghost_speed'
  | 'ghost_freeze'
  | 'ghost_phase';

/** Which role may collect each board item. The other role passes over it harmlessly. */
export const POWERUP_OWNER: Record<PowerUpType, Role> = {
  speed_boost: 'pacman',
  invincibility: 'pacman',
  pellet_multiplier: 'pacman',
  pellet_magnet: 'pacman',
  pacman_freeze: 'pacman',
  pacman_phase: 'pacman',
  ghost_speed: 'ghost',
  ghost_freeze: 'ghost',
  ghost_phase: 'ghost',
};

/** The two spawn pools. Order matters for deterministic-RNG tests; keep the
 *  three original Pac-Man items first. */
export const PACMAN_POWERUPS: readonly PowerUpType[] = [
  'speed_boost',
  'invincibility',
  'pellet_multiplier',
  'pellet_magnet',
  'pacman_freeze',
  'pacman_phase',
];
export const GHOST_POWERUPS: readonly PowerUpType[] = [
  'ghost_speed',
  'ghost_freeze',
  'ghost_phase',
];

/**
 * Active, time-limited effects that live ON a player — distinct from the
 * collectible item that grants them. The split exists because the two `*_freeze`
 * items apply `frozen` to the *opposing* players (not the collector), and the two
 * speed/phase item pairs collapse to a single effect each.
 */
export type EffectType =
  | 'speed' // from speed_boost OR ghost_speed
  | 'invincibility' // from invincibility
  | 'pellet_multiplier' // from pellet_multiplier
  | 'magnet' // from pellet_magnet
  | 'phase' // from pacman_phase OR ghost_phase
  | 'frozen'; // applied BY an opponent's *_freeze; never self-collected

/**
 * Self-effect granted to the collector of a given item. The two `*_freeze` items
 * are intentionally absent — they apply `frozen` to opponents, handled imperatively.
 */
export const ITEM_SELF_EFFECT: Partial<Record<PowerUpType, EffectType>> = {
  speed_boost: 'speed',
  ghost_speed: 'speed',
  invincibility: 'invincibility',
  pellet_multiplier: 'pellet_multiplier',
  pellet_magnet: 'magnet',
  pacman_phase: 'phase',
  ghost_phase: 'phase',
};

/** Single source of truth for effect durations (ms), mirrored by the client HUD. */
export const EFFECT_DURATION_MS: Record<EffectType, number> = {
  speed: 10_000,
  invincibility: 5_000,
  pellet_multiplier: 10_000,
  magnet: 6_000,
  phase: 3_000,
  frozen: 2_500,
};

export type Direction = 'up' | 'down' | 'left' | 'right';

export type GhostColor =
  | 'red'
  | 'pink'
  | 'cyan'
  | 'orange'
  | 'green'
  | 'violet'
  | 'yellow'
  | 'indigo'
  | 'fuchsia'
  | 'blue';

export type PacmanColor =
  | 'amber'
  | 'lime'
  | 'sky'
  | 'rose'
  | 'violet'
  | 'teal'
  | 'yellow'
  | 'indigo'
  | 'fuchsia'
  | 'blue';

/**
 * Per-room population limits, shared so the server (authoritative enforcement)
 * and the client (disabling full role toggles, "room full" UI) never drift.
 */
export const MAX_PLAYERS_PER_ROOM = 10;
export const MAX_PACMAN = 6;
export const MAX_GHOSTS = 6;

// Discrete movement cadence, shared so the client's render interpolation matches
// the server's per-player move cooldown exactly (no visible trailing).
export const BASE_MOVE_COOLDOWN_MS = 130;
export const BOOSTED_MOVE_COOLDOWN_MS = 65;

export type MapSize = 'small' | 'big';

/** Lobby-facing map metadata (the grid itself is delivered with the game state). */
export interface MapInfo {
  readonly id: string;
  readonly name: string;
  readonly size: MapSize;
  readonly width: number;
  readonly height: number;
  /** Lock threshold: the map is unavailable once playerCount exceeds this. */
  readonly maxPlayers: number;
}

/** An active, time-limited effect applied to a player. */
export interface PowerUpEffect {
  readonly type: EffectType;
  readonly endTime: number;
}

/** Generalized effect bag: effect-type -> active effect (absent when inactive). */
export type PlayerPowerUps = Partial<Record<EffectType, PowerUpEffect>>;

/** Server-side authoritative player record. */
export interface Player {
  readonly id: string;
  readonly name: string;
  /** Current role; mutates when a Pac-Man is caught and converted to a ghost. */
  role: 'pacman' | 'ghost';
  /** Role chosen in the lobby; restored on restart so converted players revert. */
  lobbyRole: 'pacman' | 'ghost';
  ghostColor?: GhostColor | null;
  pacmanColor?: PacmanColor | null;
  /** Index of the spawn slot for the current role; drives spawn/respawn position. */
  spawnSlot: number | null;
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
  /** Denormalized from {@link POWERUP_OWNER} so the client can pick a team shape/color. */
  readonly owner: Role;
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
  readonly pacmanColor?: PacmanColor | null | undefined;
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
    readonly is_host: boolean;
    readonly game_state: ClientGameState;
  }) => void;
  join_failed: (data: { readonly reason: string }) => void;
  player_joined: (data: { readonly player: ClientPlayer; readonly can_start: boolean }) => void;
  player_left: (data: { readonly player_id: string }) => void;
  /** A waiting player toggled their lobby role (Pac-Man <-> ghost). */
  player_role_changed: (data: {
    readonly player_id: string;
    readonly role: 'pacman' | 'ghost';
    readonly ghostColor?: GhostColor | null;
    readonly pacmanColor?: PacmanColor | null;
    readonly can_start: boolean;
  }) => void;
  /** A waiting player changed their avatar color (free choice; duplicates allowed). */
  player_color_changed: (data: {
    readonly player_id: string;
    readonly ghostColor?: GhostColor | null;
    readonly pacmanColor?: PacmanColor | null;
  }) => void;
  /** A role switch was rejected because the target role is already at its cap. */
  role_change_failed: (data: { readonly reason: string }) => void;
  /** Lobby map-vote tallies and the currently-leading (to-be-played) map. */
  lobby_map_state: (data: {
    readonly votes: Readonly<Record<string, number>>;
    readonly selectedMapId: string;
  }) => void;
  /** The host tried to start without at least one of each role. */
  start_failed: (data: { readonly reason: string }) => void;
  /** A Pac-Man was caught and permanently converted into a ghost. */
  player_converted: (data: {
    readonly player_id: string;
    readonly ghostColor: GhostColor | null;
    readonly x: number;
    readonly y: number;
  }) => void;
  /** Carries the final board: the selected map's maze/spawns/colors are only fixed at start. */
  game_started: (data: { readonly game_state: ClientGameState }) => void;
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
  power_up_spawned: (data: {
    readonly type: PowerUpType;
    readonly owner: Role;
    readonly position: string;
  }) => void;
  /** A board item was picked up by its owning role (cosmetic on the client). */
  power_up_collected: (data: {
    readonly player_id: string;
    readonly type: PowerUpType;
    readonly position: string;
  }) => void;
  /** A timed effect was applied to a player (self-collected, or `frozen` from an opponent). */
  effect_applied: (data: {
    readonly player_id: string;
    readonly effect: EffectType;
    readonly endTime: number;
  }) => void;
  /** A timed effect ended on a player. */
  effect_expired: (data: { readonly player_id: string; readonly effect: EffectType }) => void;
  /** A board boost vanished uncollected after its on-board lifetime. */
  power_up_despawned: (data: { readonly position: string }) => void;
  game_over: (data: { readonly winner: 'pacman' | 'ghosts'; readonly score: number }) => void;
  game_restarted: (data: { readonly game_state: ClientGameState }) => void;
  rooms_list: (data: { readonly rooms: readonly RoomInfo[] }) => void;
  room_created: (data: { readonly roomId: string; readonly roomName: string }) => void;
}

/** Events clients emit to the server. */
export interface ClientToServerEvents {
  join_game: (data: {
    readonly name: string;
    readonly roomCode?: string;
    readonly role?: Role;
  }) => void;
  create_room: (data: {
    readonly name: string;
    readonly roomName: string;
    readonly role?: Role;
  }) => void;
  list_rooms: () => void;
  player_move: (data: { readonly direction: Direction }) => void;
  set_role: (data: { readonly role: 'pacman' | 'ghost' }) => void;
  /** Pick an avatar color from the current role's palette (duplicates allowed). */
  set_color: (data: { readonly color: string }) => void;
  /** Cast/replace this player's vote for the map to play. */
  vote_map: (data: { readonly mapId: string }) => void;
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
