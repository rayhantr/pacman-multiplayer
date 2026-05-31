export { EFFECT_DURATION_MS } from '../../shared/types';

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
  /** Per-item colors for the board orbs/diamonds (keyed by the 9 PowerUpType item types). */
  powerUp: {
    speed_boost: '#34d399',
    invincibility: '#e879f9',
    pellet_multiplier: '#38bdf8',
    pellet_magnet: '#facc15',
    pacman_freeze: '#a5f3fc',
    pacman_phase: '#c4b5fd',
    ghost_speed: '#4ade80',
    ghost_freeze: '#93c5fd',
    ghost_phase: '#f9a8d4',
  },
  /** Per-effect colors for player auras + HUD timers (keyed by the 6 EffectType effects). */
  effect: {
    speed: '#34d399',
    invincibility: '#e879f9',
    pellet_multiplier: '#38bdf8',
    magnet: '#facc15',
    phase: '#c4b5fd',
    frozen: '#a5f3fc',
  },
} as const;
