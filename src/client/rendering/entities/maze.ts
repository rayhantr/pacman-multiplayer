import { COLORS } from '../../core/constants';
import type { LocalGameState } from '../../core/types';

/** Draw the maze walls with a cheap top/left inner highlight lip for depth. */
export function drawMaze(
  ctx: CanvasRenderingContext2D,
  cell: number,
  maze: LocalGameState['maze']
): void {
  if (!maze.length) {
    return;
  }

  const s = cell;
  const lip = Math.max(1, Math.round(s * 0.12));
  for (let y = 0; y < maze.length; y++) {
    const row = maze[y]!;
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== 1) {
        continue;
      }
      const px = x * s;
      const py = y * s;
      ctx.fillStyle = COLORS.wall;
      ctx.fillRect(px, py, s, s);
      // Cheap top/left inner highlight for depth — no per-cell shadowBlur.
      ctx.fillStyle = COLORS.wallHighlight;
      ctx.fillRect(px, py, s, lip);
      ctx.fillRect(px, py, lip, s);
    }
  }
}
