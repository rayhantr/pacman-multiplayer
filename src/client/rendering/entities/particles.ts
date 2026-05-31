import type { Particle } from '../../core/types';

/** Draw short-lived burst particles, fading out over their lifetime. */
export function drawParticles(
  ctx: CanvasRenderingContext2D,
  cell: number,
  particles: Particle[]
): void {
  if (!particles.length) {
    return;
  }
  for (const p of particles) {
    const cx = p.x * cell + cell / 2;
    const cy = p.y * cell + cell / 2;
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(cx, cy, p.size * cell, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
