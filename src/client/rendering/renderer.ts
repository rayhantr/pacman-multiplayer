import { COLORS, MAZE_WIDTH, MAZE_HEIGHT } from '../core/constants';
import type { Effects } from './effects';
import type { LocalGameState, RenderPlayer } from '../core/types';
import { drawMaze } from './entities/maze';
import { drawPellets } from './entities/pellet';
import { drawPowerUps } from './entities/powerup';
import { drawParticles } from './entities/particles';
import { drawAura } from './entities/aura';
import { drawPacman, drawDeath } from './entities/pacman';
import { drawGhost } from './entities/ghost';

/**
 * Owns the canvas, its 2D context, and the device-pixel cell size, and drives the
 * frame loop. Each game entity (maze, pellets, power-ups, particles, Pac-Man,
 * ghost…) draws itself from its own module under ./entities; this class stays a
 * thin orchestrator and never touches sockets or the DOM chrome.
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
    drawMaze(this.ctx, this.CELL_SIZE, gameState.maze);
    drawPellets(this.ctx, this.CELL_SIZE, gameState.pellets, now);
    drawPowerUps(this.ctx, this.CELL_SIZE, gameState.powerUps, now);
    effects.update(dt);
    drawParticles(this.ctx, this.CELL_SIZE, effects.particles);
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

  /**
   * Resolve each player's interpolated pixel position and hand off to the
   * matching entity drawer. While Pac-Man is being eaten, the death animation
   * owns the canvas players.
   */
  private drawPlayers(players: Record<string, RenderPlayer>, effects: Effects, now: number): void {
    if (effects.deathAnim) {
      if (drawDeath(this.ctx, this.CELL_SIZE, effects.deathAnim, now)) {
        effects.clearDeath();
      }
      return;
    }

    Object.values(players).forEach(player => {
      const renderX = player.renderX ?? player.x;
      const renderY = player.renderY ?? player.y;
      const centerX = renderX * this.CELL_SIZE + this.CELL_SIZE / 2;
      const centerY = renderY * this.CELL_SIZE + this.CELL_SIZE / 2;
      const radius = this.CELL_SIZE / 2 - this.CELL_SIZE * 0.07;

      drawAura(this.ctx, this.CELL_SIZE, player, centerX, centerY, now);

      const phasing = !!player.activePowerUps?.phase;
      const frozen = !!player.activePowerUps?.frozen;

      if (player.role === 'pacman') {
        drawPacman(this.ctx, {
          cx: centerX,
          cy: centerY,
          radius,
          direction: player.direction,
          lastMoveTime: player.lastMoveTime,
          now,
          pacmanColor: player.pacmanColor,
          phasing,
          frozen,
        });
      } else {
        const ghostColor = player.ghostColor as keyof typeof COLORS.ghost;
        const color = COLORS.ghost[ghostColor] || COLORS.ghost.red;
        drawGhost(this.ctx, centerX, centerY, radius, color, player.direction, phasing, frozen);
      }
    });
  }
}
