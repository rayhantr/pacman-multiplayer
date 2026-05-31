import { COLORS } from '../../core/constants';

/** Draw the remaining pellets as small, gently pulsing dots. */
export function drawPellets(
  ctx: CanvasRenderingContext2D,
  cell: number,
  pellets: Set<string>,
  now: number
): void {
  const pulse = 0.85 + 0.15 * Math.sin(now / 240);
  const radius = cell * 0.1 * pulse;
  ctx.fillStyle = COLORS.pellet;
  pellets.forEach(pelletPos => {
    const [x, y] = pelletPos.split(',').map(Number);
    const centerX = x! * cell + cell / 2;
    const centerY = y! * cell + cell / 2;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}
