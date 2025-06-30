export interface Position {
  x: number;
  y: number;
}

export interface PowerUpEffect {
  type: 'speed_boost' | 'invincibility' | 'pellet_multiplier';
  endTime: number;
}

export interface Player {
  id: string;
  name: string;
  role: 'pacman' | 'ghost';
  ghostColor?: 'red' | 'pink' | 'cyan' | 'orange' | null;
  position: Position;
  direction: 'up' | 'down' | 'left' | 'right';
  speed: number;
  powerUps: {
    speedBoost: PowerUpEffect | null;
    invincibility: PowerUpEffect | null;
    pelletMultiplier: PowerUpEffect | null;
  };
  isAlive: boolean;
}

export interface PowerUp {
  type: 'speed_boost' | 'invincibility' | 'pellet_multiplier';
  position: Position;
  spawnTime: number;
}

export interface GameState {
  isStarted: boolean;
  isGameOver: boolean;
  winner: 'pacman' | 'ghosts' | null;
  score: number;
  pelletsRemaining: number;
  maze: number[][];
  pellets: Set<string>;
  powerUps: Map<string, PowerUp>;
  startTime: number | null;
}

// Client-side game state (simplified for network transmission)
export interface ClientGameState {
  players: ClientPlayer[];
  maze: number[][];
  pellets: string[];
  powerUps: { [key: string]: PowerUp };
  score: number;
  pelletsRemaining: number;
  canStart: boolean;
}

export interface ClientPlayer {
  id: string;
  name: string;
  role: 'pacman' | 'ghost';
  ghostColor?: string | null;
  x: number;
  y: number;
  direction: string;
}

// Socket event types
export interface ServerToClientEvents {
  join_success: (_data: { player_id: string; role: string; game_state: GameState }) => void;
  join_failed: (_data: { reason: string }) => void;
  player_joined: (_data: { player: ClientPlayer; can_start: boolean }) => void;
  player_left: (_data: { player_id: string }) => void;
  game_started: () => void;
  player_moved: (_data: { 
    player_id: string; 
    x: number; 
    y: number; 
    direction: string; 
    score: number; 
    pellets_remaining: number 
  }) => void;
  power_up_spawned: (_data: { type: string; position: string }) => void;
  power_up_collected: (_data: { player_id: string; type: string; position: string }) => void;
  game_over: (_data: { winner: string; score: number }) => void;
}

export interface ClientToServerEvents {
  join_game: (_data: { name: string }) => void;
  player_move: (_data: { direction: string }) => void;
  start_game: () => void;
}

