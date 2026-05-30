import type { PowerUpType } from '../shared/types';

/** Maze dimensions in cells (fallbacks before the server sends the real maze). */
export const MAZE_WIDTH = 20;
export const MAZE_HEIGHT = 19;

/**
 * Palette for the in-game canvas world. Deliberately separate from the flat UI
 * chrome (which lives in styles.css `@theme`): the canvas may glow/round, the
 * chrome may not.
 */
export const COLORS = {
  wall: '#475569',
  wallHighlight: '#64748b',
  path: '#0f172a',
  pellet: '#fbbf24',
  pacman: '#f59e0b',
  /** Distinct per-Pac-Man colors so multiple Pac-Men are tellable apart. */
  pacmanColors: {
    amber: '#f59e0b',
    lime: '#a3e635',
    sky: '#38bdf8',
    rose: '#fb7185',
    violet: '#c084fc',
  },
  ghost: {
    red: '#fb7185',
    pink: '#f0abfc',
    cyan: '#38bdf8',
    orange: '#fb923c',
  },
  powerUp: {
    speed_boost: '#34d399',
    invincibility: '#e879f9',
    pellet_multiplier: '#38bdf8',
  },
} as const;

/** Server-side power-up durations (ms); mirrors the server to fade auras + HUD timers. */
export const POWERUP_DURATIONS: Record<PowerUpType, number> = {
  speed_boost: 10000,
  invincibility: 5000,
  pellet_multiplier: 10000,
};
