import { COLORS, MAZE_WIDTH, MAZE_HEIGHT } from './constants';
import type { Effects } from './effects';
import type { LocalGameState, Particle, RenderPlayer } from './types';

/**
 * Owns the canvas, its 2D context, and the device-pixel cell size, and draws the
 * entire game world each frame. Pure renderer: it reads game state + effects that
 * are passed in and never touches sockets or the DOM chrome.
 */
export class Renderer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  // Recomputed by resize() to fill the screen; drawing is in device px.
  private CELL_SIZE = 30;
  // Timestamp of the previous frame, for frame-rate-independent particle motion.
  private lastFrameTime = 0;

  constructor() {
    this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    if (!this.canvas) {
      console.error('Canvas element not found');
      return;
    }

    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.width = MAZE_WIDTH * this.CELL_SIZE;
    this.canvas.height = MAZE_HEIGHT * this.CELL_SIZE;
  }

  /**
   * Recompute CELL_SIZE and the canvas resolution to fill the available area
   * while preserving the maze's aspect ratio. Drawing happens in device pixels
   * (CELL_SIZE folds in devicePixelRatio) so the maze stays crisp at any size.
   */
  resize(maze: LocalGameState['maze']): void {
    if (!this.canvas) {
      return;
    }

    const container = this.canvas.parentElement;
    if (!container) {
      return;
    }

    const cols = maze[0]?.length ?? MAZE_WIDTH;
    const rows = maze.length ?? MAZE_HEIGHT;
    if (cols <= 0 || rows <= 0) {
      return;
    }

    // Content box of the container (clientWidth/Height exclude border, include
    // padding) minus its padding gives the area available to the canvas.
    const style = getComputedStyle(container);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availW = Math.max(0, container.clientWidth - padX);
    const availH = Math.max(0, container.clientHeight - padY);
    if (availW === 0 || availH === 0) {
      return;
    }

    const cssCell = Math.max(1, Math.floor(Math.min(availW / cols, availH / rows)));
    const dpr = window.devicePixelRatio || 1;

    this.CELL_SIZE = Math.round(cssCell * dpr);
    // Backing store in device pixels (crisp), CSS size in logical pixels.
    this.canvas.width = cols * this.CELL_SIZE;
    this.canvas.height = rows * this.CELL_SIZE;
    this.canvas.style.width = `${cols * cssCell}px`;
    this.canvas.style.height = `${rows * cssCell}px`;
  }

  /** Draw one frame. No-op until the game has started. */
  render(gameState: LocalGameState, effects: Effects, now: number): void {
    if (!gameState.gameStarted) {
      return;
    }

    const dt = this.lastFrameTime ? Math.min(now - this.lastFrameTime, 50) : 16;
    this.lastFrameTime = now;

    this.ctx.save();

    // Screenshake: jitter the whole frame (offset is in cell units → device px).
    const shake = effects.getShake(now);
    if (shake.x !== 0 || shake.y !== 0) {
      this.ctx.translate(shake.x * this.CELL_SIZE, shake.y * this.CELL_SIZE);
    }

    // Fill slightly past the edges so the shake offset never reveals the page.
    this.ctx.fillStyle = COLORS.path;
    this.ctx.fillRect(-32, -32, this.canvas.width + 64, this.canvas.height + 64);

    this.updatePlayerInterpolation(gameState.players);
    this.drawMaze(gameState.maze);
    this.drawPellets(gameState.pellets, now);
    this.drawPowerUps(gameState.powerUps, now);
    effects.update(dt);
    this.drawParticles(effects.particles);
    this.drawPlayers(gameState.players, effects, now);

    this.ctx.restore();
  }

  private updatePlayerInterpolation(players: Record<string, RenderPlayer>): void {
    const currentTime = Date.now();
    const MOVEMENT_DURATION = 200; // ms

    Object.values(players).forEach(player => {
      if (player.lastMoveTime && player.targetX !== undefined && player.targetY !== undefined) {
        const elapsed = currentTime - player.lastMoveTime;
        const progress = Math.min(elapsed / MOVEMENT_DURATION, 1);
        const easedProgress = this.easeOutCubic(progress);

        const startX = player.renderX ?? player.targetX;
        const startY = player.renderY ?? player.targetY;

        player.renderX = startX + (player.targetX - startX) * easedProgress;
        player.renderY = startY + (player.targetY - startY) * easedProgress;

        if (progress >= 1) {
          player.renderX = player.targetX;
          player.renderY = player.targetY;
          delete player.lastMoveTime;
        }
      } else {
        player.renderX = player.renderX ?? player.x;
        player.renderY = player.renderY ?? player.y;
      }
    });
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private drawMaze(maze: LocalGameState['maze']): void {
    if (!maze.length) {
      return;
    }

    const s = this.CELL_SIZE;
    const lip = Math.max(1, Math.round(s * 0.12));
    for (let y = 0; y < maze.length; y++) {
      const row = maze[y]!;
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== 1) {
          continue;
        }
        const px = x * s;
        const py = y * s;
        this.ctx.fillStyle = COLORS.wall;
        this.ctx.fillRect(px, py, s, s);
        // Cheap top/left inner highlight for depth — no per-cell shadowBlur.
        this.ctx.fillStyle = COLORS.wallHighlight;
        this.ctx.fillRect(px, py, s, lip);
        this.ctx.fillRect(px, py, lip, s);
      }
    }
  }

  private drawPellets(pellets: Set<string>, now: number): void {
    const pulse = 0.85 + 0.15 * Math.sin(now / 240);
    const radius = this.CELL_SIZE * 0.1 * pulse;
    this.ctx.fillStyle = COLORS.pellet;
    pellets.forEach(pelletPos => {
      const [x, y] = pelletPos.split(',').map(Number);
      const centerX = x! * this.CELL_SIZE + this.CELL_SIZE / 2;
      const centerY = y! * this.CELL_SIZE + this.CELL_SIZE / 2;

      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }

  private drawPowerUps(powerUps: LocalGameState['powerUps'], now: number): void {
    const entries = Object.entries(powerUps);
    if (!entries.length) {
      return;
    }

    const pulse = 0.8 + 0.2 * Math.sin(now / 180);
    this.ctx.save();
    for (const [position, powerUp] of entries) {
      const [x, y] = position.split(',').map(Number);
      const centerX = x! * this.CELL_SIZE + this.CELL_SIZE / 2;
      const centerY = y! * this.CELL_SIZE + this.CELL_SIZE / 2;
      const color = COLORS.powerUp[powerUp.type];

      // Glow is acceptable here: this is the canvas game-world, not the flat UI chrome.
      this.ctx.fillStyle = color;
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = this.CELL_SIZE * 0.6 * pulse;
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, this.CELL_SIZE * 0.27 * pulse, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  private drawParticles(particles: Particle[]): void {
    if (!particles.length) {
      return;
    }
    for (const p of particles) {
      const cx = p.x * this.CELL_SIZE + this.CELL_SIZE / 2;
      const cy = p.y * this.CELL_SIZE + this.CELL_SIZE / 2;
      this.ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, p.size * this.CELL_SIZE, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1;
  }

  private drawPlayers(players: Record<string, RenderPlayer>, effects: Effects, now: number): void {
    // While Pac-Man is being eaten, the death animation owns the canvas players.
    if (effects.deathAnim) {
      this.drawDeath(effects, now);
      return;
    }

    Object.values(players).forEach(player => {
      const renderX = player.renderX ?? player.x;
      const renderY = player.renderY ?? player.y;
      const centerX = renderX * this.CELL_SIZE + this.CELL_SIZE / 2;
      const centerY = renderY * this.CELL_SIZE + this.CELL_SIZE / 2;
      const radius = this.CELL_SIZE / 2 - this.CELL_SIZE * 0.07;

      this.drawAura(player, centerX, centerY, now);

      if (player.role === 'pacman') {
        this.drawPacman(
          centerX,
          centerY,
          radius,
          player.direction,
          player.lastMoveTime,
          now,
          player.pacmanColor
        );
      } else {
        const ghostColor = player.ghostColor as keyof typeof COLORS.ghost;
        const color = COLORS.ghost[ghostColor] || COLORS.ghost.red;
        this.drawGhost(centerX, centerY, radius, color, player.direction);
      }
    });
  }

  /** Base facing angle (radians) for a movement direction; 0 = right. */
  private directionAngle(direction: string): number {
    switch (direction) {
      case 'up':
        return -Math.PI / 2;
      case 'down':
        return Math.PI / 2;
      case 'left':
        return Math.PI;
      default:
        return 0; // right
    }
  }

  /** Pulsing ring around a player that currently holds a power-up. */
  private drawAura(player: RenderPlayer, cx: number, cy: number, now: number): void {
    const active = player.activePowerUps;
    const types = active ? (Object.keys(active) as (keyof typeof COLORS.powerUp)[]) : [];
    if (!types.length) {
      return;
    }

    const color = COLORS.powerUp[types[0]!];
    const pulse = 0.5 + 0.5 * Math.sin(now / 150);
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.globalAlpha = 0.45 + 0.4 * pulse;
    this.ctx.lineWidth = Math.max(1, this.CELL_SIZE * 0.08);
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = this.CELL_SIZE * 0.5;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, this.CELL_SIZE * (0.5 + 0.08 * pulse), 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  /** Pac-Man as a wedge whose mouth opens toward travel and chomps while moving. */
  private drawPacman(
    cx: number,
    cy: number,
    radius: number,
    direction: string,
    lastMoveTime: number | undefined,
    now: number,
    pacmanColor?: string | null
  ): void {
    const base = this.directionAngle(direction);
    const moving = lastMoveTime !== undefined && now - lastMoveTime < 350;
    const openMax = 0.28 * Math.PI;
    const mouth = moving ? (0.5 + 0.5 * Math.sin(now / 70)) * openMax : 0.04 * Math.PI;

    const key = pacmanColor as keyof typeof COLORS.pacmanColors;
    const mapped = pacmanColor ? COLORS.pacmanColors[key] : undefined;
    this.ctx.fillStyle = mapped ?? COLORS.pacman;
    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy);
    this.ctx.arc(cx, cy, radius, base + mouth, base - mouth + Math.PI * 2);
    this.ctx.closePath();
    this.ctx.fill();

    // Eye, offset to the side of the facing direction.
    const eyeAngle = base - Math.PI / 2;
    const ex = cx + Math.cos(eyeAngle) * radius * 0.35;
    const ey = cy + Math.sin(eyeAngle) * radius * 0.35;
    this.ctx.fillStyle = COLORS.path;
    this.ctx.beginPath();
    this.ctx.arc(ex, ey, Math.max(1, radius * 0.12), 0, Math.PI * 2);
    this.ctx.fill();
  }

  /** Classic ghost: rounded dome, scalloped skirt, and eyes that look where it moves. */
  private drawGhost(
    cx: number,
    cy: number,
    radius: number,
    color: string,
    direction: string
  ): void {
    const r = radius;
    const bottom = cy + r;

    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, Math.PI, 0, false); // dome; pen ends at (cx + r, cy)
    const humps = 3;
    const seg = (2 * r) / humps;
    for (let i = 0; i < humps; i++) {
      const xRight = cx + r - i * seg;
      const xMid = xRight - seg / 2;
      const xLeft = xRight - seg;
      this.ctx.lineTo(xRight, bottom);
      this.ctx.lineTo(xMid, bottom - r * 0.4);
      this.ctx.lineTo(xLeft, bottom);
    }
    this.ctx.closePath();
    this.ctx.fill();

    // Eyes: whites with pupils nudged toward the travel direction.
    const eyeDx = r * 0.38;
    const eyeY = cy - r * 0.1;
    const eyeR = r * 0.28;
    const pupilR = r * 0.14;
    const look = this.directionAngle(direction);
    const px = Math.cos(look) * eyeR * 0.4;
    const py = Math.sin(look) * eyeR * 0.4;
    for (const sx of [-eyeDx, eyeDx]) {
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(cx + sx, eyeY, eyeR, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = '#1d4ed8';
      this.ctx.beginPath();
      this.ctx.arc(cx + sx + px, eyeY + py, pupilR, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  /** The classic shrink-and-vanish when Pac-Man is caught (cell coords → px). */
  private drawDeath(effects: Effects, now: number): void {
    const d = effects.deathAnim;
    if (!d) {
      return;
    }
    const t = Math.min((now - d.startTime) / 800, 1);
    const radius = (this.CELL_SIZE / 2 - this.CELL_SIZE * 0.07) * (1 - t);
    const open = t * Math.PI; // mouth widens until it swallows the whole circle
    const cx = d.x * this.CELL_SIZE + this.CELL_SIZE / 2;
    const cy = d.y * this.CELL_SIZE + this.CELL_SIZE / 2;

    this.ctx.fillStyle = d.color;
    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy);
    this.ctx.arc(cx, cy, Math.max(0, radius), open, Math.PI * 2 - open);
    this.ctx.closePath();
    this.ctx.fill();

    if (t >= 1) {
      effects.clearDeath();
    }
  }
}
