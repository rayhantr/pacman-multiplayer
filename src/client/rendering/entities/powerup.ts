import { COLORS } from '../../core/constants';
import type { LocalGameState } from '../../core/types';
import { ICON_CANVAS_PATHS, POWERUP_EFFECT } from '../../ui/icons';

/**
 * Draw spawned power-ups (glow is fine in the canvas world). The two team sets are
 * tellable apart by SHAPE — Pac-Man items are round orbs, ghost items are diamonds —
 * and by per-type color + a vector glyph matching the HUD/legend icons.
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

    // Glyph: stroke the same icon as the HUD/legend, dark and un-glowed on top so
    // the kind reads clearly. Paths are on a 24-unit grid (see ICON_CANVAS_PATHS).
    const g = cell * 0.4; // glyph box size
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.translate(centerX - g / 2, centerY - g / 2);
    ctx.scale(g / 24, g / 24);
    ctx.strokeStyle = COLORS.path;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const d of ICON_CANVAS_PATHS[POWERUP_EFFECT[powerUp.type]]) {
      ctx.stroke(new Path2D(d));
    }
    ctx.restore();
  }
  ctx.restore();
}
