import { COLORS } from '../../core/constants';
import type { LocalGameState } from '../../core/types';
import type { PowerUpType } from '../../../shared/types';

/** Tiny glyph drawn on each item so its kind is tellable at a glance. */
const POWERUP_GLYPH: Record<PowerUpType, string> = {
  speed_boost: '»',
  ghost_speed: '»',
  invincibility: '★',
  pellet_multiplier: '×2',
  pellet_magnet: 'U',
  pacman_freeze: '❄',
  ghost_freeze: '❄',
  pacman_phase: '◌',
  ghost_phase: '◌',
};

/**
 * Draw spawned power-ups (glow is fine in the canvas world). The two team sets are
 * tellable apart by SHAPE — Pac-Man items are round orbs, ghost items are diamonds —
 * and by per-type color + glyph.
 */
export function drawPowerUps(
  ctx: CanvasRenderingContext2D,
  cell: number,
  powerUps: LocalGameState['powerUps'],
  now: number
): void {
  const entries = Object.entries(powerUps);
  if (!entries.length) {
    return;
  }

  const pulse = 0.8 + 0.2 * Math.sin(now / 180);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [position, powerUp] of entries) {
    const [x, y] = position.split(',').map(Number);
    const centerX = x! * cell + cell / 2;
    const centerY = y! * cell + cell / 2;
    const color = COLORS.powerUp[powerUp.type];
    const r = cell * 0.27 * pulse;

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = cell * 0.6 * pulse;

    if (powerUp.owner === 'ghost') {
      // Diamond (rotated square) marks the ghost set.
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - r);
      ctx.lineTo(centerX + r, centerY);
      ctx.lineTo(centerX, centerY + r);
      ctx.lineTo(centerX - r, centerY);
      ctx.closePath();
      ctx.fill();
    } else {
      // Round orb marks the Pac-Man set.
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Glyph: drawn dark and un-glowed on top so the kind reads clearly.
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.path;
    ctx.font = `bold ${Math.round(cell * 0.32)}px system-ui, sans-serif`;
    ctx.fillText(POWERUP_GLYPH[powerUp.type], centerX, centerY + cell * 0.02);
  }
  ctx.restore();
}
