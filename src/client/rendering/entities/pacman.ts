import { COLORS } from '../../core/constants';
import { directionAngle } from './directions';

/** Everything drawPacman needs, in pixel coords already resolved by the renderer. */
export interface PacmanOptions {
  cx: number;
  cy: number;
  radius: number;
  direction: string;
  lastMoveTime: number | undefined;
  now: number;
  pacmanColor?: string | null | undefined;
  /** Wall-phasing: drawn translucent. */
  phasing?: boolean;
  /** Frozen by an opponent: drawn with an ice tint. */
  frozen?: boolean;
}

/** Translucent ice-blue overlay + frost ring marking a frozen entity. */
export function drawFrozenOverlay(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(165, 243, 252, 0.45)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.9)';
  ctx.lineWidth = Math.max(1, radius * 0.12);
  ctx.stroke();
  ctx.restore();
}

/** The death animation's cell-space state (mirrors Effects.deathAnim). */
export interface DeathAnim {
  startTime: number;
  x: number;
  y: number;
  color: string;
}

/** Pac-Man as a wedge whose mouth opens toward travel and chomps while moving. */
export function drawPacman(ctx: CanvasRenderingContext2D, opts: PacmanOptions): void {
  const { cx, cy, radius, direction, lastMoveTime, now, pacmanColor, phasing, frozen } = opts;
  const base = directionAngle(direction);
  const moving = lastMoveTime !== undefined && now - lastMoveTime < 350;
  const openMax = 0.28 * Math.PI;
  const mouth = moving ? (0.5 + 0.5 * Math.sin(now / 70)) * openMax : 0.04 * Math.PI;

  ctx.save();
  if (phasing) {
    ctx.globalAlpha = 0.45;
  }

  const key = pacmanColor as keyof typeof COLORS.pacmanColors;
  const mapped = pacmanColor ? COLORS.pacmanColors[key] : undefined;
  ctx.fillStyle = mapped ?? COLORS.pacman;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, base + mouth, base - mouth + Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  // Eye, offset to the side of the facing direction.
  const eyeAngle = base - Math.PI / 2;
  const ex = cx + Math.cos(eyeAngle) * radius * 0.35;
  const ey = cy + Math.sin(eyeAngle) * radius * 0.35;
  ctx.fillStyle = COLORS.path;
  ctx.beginPath();
  ctx.arc(ex, ey, Math.max(1, radius * 0.12), 0, Math.PI * 2);
  ctx.fill();

  if (frozen) {
    drawFrozenOverlay(ctx, cx, cy, radius);
  }
  ctx.restore();
}

/**
 * The classic shrink-and-vanish when Pac-Man is caught (cell coords → px).
 * Returns true once the animation has completed, so the caller can clear it.
 */
export function drawDeath(
  ctx: CanvasRenderingContext2D,
  cell: number,
  anim: DeathAnim,
  now: number
): boolean {
  const t = Math.min((now - anim.startTime) / 800, 1);
  const radius = (cell / 2 - cell * 0.07) * (1 - t);
  const open = t * Math.PI; // mouth widens until it swallows the whole circle
  const cx = anim.x * cell + cell / 2;
  const cy = anim.y * cell + cell / 2;

  ctx.fillStyle = anim.color;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, Math.max(0, radius), open, Math.PI * 2 - open);
  ctx.closePath();
  ctx.fill();

  return t >= 1;
}
