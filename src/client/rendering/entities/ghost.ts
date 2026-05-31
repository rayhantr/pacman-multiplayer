import { directionAngle } from './directions';
import { drawFrozenOverlay } from './pacman';

/** Classic ghost: rounded dome, scalloped skirt, and eyes that look where it moves. */
export function drawGhost(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  direction: string,
  phasing = false,
  frozen = false
): void {
  const r = radius;
  const bottom = cy + r;

  ctx.save();
  if (phasing) {
    ctx.globalAlpha = 0.45;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0, false); // dome; pen ends at (cx + r, cy)
  const humps = 3;
  const seg = (2 * r) / humps;
  for (let i = 0; i < humps; i++) {
    const xRight = cx + r - i * seg;
    const xMid = xRight - seg / 2;
    const xLeft = xRight - seg;
    ctx.lineTo(xRight, bottom);
    ctx.lineTo(xMid, bottom - r * 0.4);
    ctx.lineTo(xLeft, bottom);
  }
  ctx.closePath();
  ctx.fill();

  // Eyes: whites with pupils nudged toward the travel direction.
  const eyeDx = r * 0.38;
  const eyeY = cy - r * 0.1;
  const eyeR = r * 0.28;
  const pupilR = r * 0.14;
  const look = directionAngle(direction);
  const px = Math.cos(look) * eyeR * 0.4;
  const py = Math.sin(look) * eyeR * 0.4;
  for (const sx of [-eyeDx, eyeDx]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + sx, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(cx + sx + px, eyeY + py, pupilR, 0, Math.PI * 2);
    ctx.fill();
  }

  if (frozen) {
    drawFrozenOverlay(ctx, cx, cy, r);
  }
  ctx.restore();
}
