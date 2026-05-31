import { COLORS } from '../../core/constants';
import type { RenderPlayer } from '../../core/types';

/** Pulsing ring around a player that currently holds a power-up. */
export function drawAura(
  ctx: CanvasRenderingContext2D,
  cell: number,
  player: RenderPlayer,
  cx: number,
  cy: number,
  now: number
): void {
  const active = player.activePowerUps;
  // `frozen` is rendered as a body tint (see pacman/ghost), not an aura ring.
  const types = active
    ? (Object.keys(active) as (keyof typeof COLORS.effect)[]).filter(t => t !== 'frozen')
    : [];
  if (!types.length) {
    return;
  }

  const color = COLORS.effect[types[0]!];
  const pulse = 0.5 + 0.5 * Math.sin(now / 150);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.45 + 0.4 * pulse;
  ctx.lineWidth = Math.max(1, cell * 0.08);
  ctx.shadowColor = color;
  ctx.shadowBlur = cell * 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, cell * (0.5 + 0.08 * pulse), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
