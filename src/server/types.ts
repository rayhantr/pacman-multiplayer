export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface PowerUpEffect {
  readonly type: 'speed_boost' | 'invincibility' | 'pellet_multiplier';
  readonly endTime: number;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly role: 'pacman' | 'ghost';
  readonly ghostColor?: 'red' | 'pink' | 'cyan' | 'orange' | null;
  position: Position;
  direction: 'up' | 'down' | 'left' | 'right';
  readonly speed: number;
  powerUps: {
    speedBoost: PowerUpEffect | null;
    invincibility: PowerUpEffect | null;
    pelletMultiplier: PowerUpEffect | null;
  };
  isAlive: boolean;
}

export interface PowerUp {
  readonly type: 'speed_boost' | 'invincibility' | 'pellet_multiplier';
  readonly position: Position;
  readonly spawnTime: number;
}

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

// Client-side game state (simplified for network transmission)
export interface ClientGameState {
  readonly players: readonly ClientPlayer[];
  readonly maze: readonly (readonly number[])[];
  readonly pellets: readonly string[];
  readonly powerUps: Readonly<Record<string, PowerUp>>;
  readonly score: number;
  readonly pelletsRemaining: number;
  readonly canStart: boolean;
}

export interface ClientPlayer {
  readonly id: string;
  readonly name: string;
  readonly role: 'pacman' | 'ghost';
  readonly ghostColor?: 'red' | 'pink' | 'cyan' | 'orange' | null | undefined;
  readonly x: number;
  readonly y: number;
  readonly direction: string;
}

// Direction type for better type safety
export type Direction = 'up' | 'down' | 'left' | 'right';

// Room information
export interface RoomInfo {
  readonly id: string;
  readonly name: string;
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly isStarted: boolean;
  readonly isGameOver: boolean;
}

// Socket event types with proper typing
export interface ServerToClientEvents {
  join_success: (data: {
    readonly player_id: string;
    readonly role: string;
    readonly game_state: GameState;
  }) => void;
  join_failed: (data: { readonly reason: string }) => void;
  player_joined: (data: { readonly player: ClientPlayer; readonly can_start: boolean }) => void;
  player_left: (data: { readonly player_id: string }) => void;
  game_started: () => void;
  player_moved: (data: {
    readonly player_id: string;
    readonly x: number;
    readonly y: number;
    readonly direction: string;
    readonly score: number;
    readonly pellets_remaining: number;
    readonly pellet_collected: boolean;
  }) => void;
  pellet_collected: (data: {
    readonly position: string;
    readonly score: number;
    readonly pellets_remaining: number;
  }) => void;
  power_up_spawned: (data: { readonly type: string; readonly position: string }) => void;
  power_up_collected: (data: {
    readonly player_id: string;
    readonly type: string;
    readonly position: string;
  }) => void;
  game_over: (data: { readonly winner: string; readonly score: number }) => void;
  game_restarted: (data: { readonly game_state: ClientGameState }) => void;
  rooms_list: (data: { readonly rooms: readonly RoomInfo[] }) => void;
  room_created: (data: { readonly roomId: string; readonly roomName: string }) => void;
}

export interface ClientToServerEvents {
  join_game: (data: { readonly name: string; readonly room?: string }) => void;
  create_room: (data: { readonly name: string; readonly roomName: string }) => void;
  list_rooms: () => void;
  player_move: (data: { readonly direction: Direction }) => void;
  start_game: () => void;
  restart_game: () => void;
  leave_game: () => void;
}

// Additional Socket.IO types
export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  readonly userId?: string;
  readonly userName?: string;
}
