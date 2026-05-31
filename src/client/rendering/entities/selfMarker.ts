/**
 * "This is you" marker: a small bobbing triangle hovering over the local
 * player's avatar so they can find themselves in a crowd (Feature 4). The HUD
 * already tints by role; this points at the actual sprite on the board.
 */
export function drawSelfMarker(
  ctx: CanvasRenderingContext2D,
  cell: number,
  cx: number,
  cy: number,
  radius: number,
  now: number
): void {
  const bob = Math.sin(now / 250) * cell * 0.08;
  const size = cell * 0.32;
  const top = cy - radius - cell * 0.3 + bob; // tip points down toward the avatar

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = COLORS_OUTLINE;
  ctx.lineWidth = Math.max(1, cell * 0.04);
  ctx.beginPath();
  ctx.moveTo(cx - size / 2, top);
  ctx.lineTo(cx + size / 2, top);
  ctx.lineTo(cx, top + size * 0.85);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Matches the canvas path background so the marker reads as a crisp chevron.
const COLORS_OUTLINE = '#0f172a';
