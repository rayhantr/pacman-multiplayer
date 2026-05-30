import type { PowerUpType, RoomInfo } from '../shared/types';

/** Client-local player record: the wire shape plus interpolation fields. */
export interface RenderPlayer {
  id: string;
  name: string;
  role: 'pacman' | 'ghost';
  ghostColor?: string | null | undefined;
  pacmanColor?: string | null | undefined;
  x: number;
  y: number;
  direction: string;
  // Smooth-movement interpolation state
  renderX?: number;
  renderY?: number;
  targetX?: number;
  targetY?: number;
  lastMoveTime?: number;
  // Active power-up effects on this player (type -> end timestamp), drives aura + HUD timers.
  activePowerUps?: Partial<Record<PowerUpType, { endTime: number; duration: number }>>;
}

export interface SpawnedPowerUp {
  type: PowerUpType;
  spawnTime: number;
}

/** A short-lived canvas particle (positions in maze-cell units, like players). */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface LocalGameState {
  players: Record<string, RenderPlayer>;
  maze: readonly (readonly number[])[];
  pellets: Set<string>;
  powerUps: Record<string, SpawnedPowerUp>;
  score: number;
  pelletsRemaining: number;
  gameStarted: boolean;
  gameOver: boolean;
  playerId: string | null;
  playerRole: string | null;
  selectedRoom: string | null;
  rooms: RoomInfo[];
}
