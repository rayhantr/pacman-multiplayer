import type { Particle } from './types';

/**
 * Game-feel ("juice") state and logic: particle bursts, screenshake, and the
 * Pac-Man death animation. Deliberately pixel-agnostic — everything is stored in
 * maze-cell units so this module never needs to know the canvas cell size. The
 * Renderer converts to device pixels at draw time.
 */
export class Effects {
  /** Short-lived particles (pellet/power-up bursts); positions in cell units. */
  particles: Particle[] = [];
  /** Active Pac-Man death animation (cell coords); null when not dying. */
  deathAnim: { startTime: number; x: number; y: number; color: string } | null = null;

  /** Screenshake decays to zero at this timestamp; magnitude is a fraction of a cell. */
  private shakeUntil = 0;
  private shakeMagnitudeCells = 0;

  /** Spawn a radial burst of particles at a maze cell (positions in cell units). */
  spawnBurst(cellX: number, cellY: number, color: string, count = 8): void {
    if (this.particles.length > 300) {
      return; // backstop against runaway growth
    }
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (i % 2) * 0.4;
      const speed = 1.2 + (i % 3) * 0.5; // cells per second
      this.particles.push({
        x: cellX,
        y: cellY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 380,
        maxLife: 380,
        color,
        size: 0.05 + (i % 2) * 0.02,
      });
    }
  }

  /** Advance particle physics and cull dead ones. Drawing happens in the Renderer. */
  update(dt: number): void {
    if (!this.particles.length) {
      return;
    }
    const next: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) {
        continue;
      }
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
      p.vy += (3 * dt) / 1000; // gentle gravity
      next.push(p);
    }
    this.particles = next;
  }

  triggerShake(durationMs: number, magnitudeCells: number): void {
    this.shakeUntil = Date.now() + durationMs;
    this.shakeMagnitudeCells = magnitudeCells;
  }

  /** Current shake offset in CELL units for the given time (zero when inactive). */
  getShake(now: number): { x: number; y: number } {
    if (now >= this.shakeUntil) {
      return { x: 0, y: 0 };
    }
    const remaining = (this.shakeUntil - now) / 300;
    const mag = this.shakeMagnitudeCells * remaining;
    return { x: Math.sin(now / 17) * mag, y: Math.cos(now / 13) * mag };
  }

  /** Begin the death shrink at a maze cell (called when ghosts win). */
  triggerDeath(cellX: number, cellY: number, color: string): void {
    this.deathAnim = { startTime: Date.now(), x: cellX, y: cellY, color };
  }

  clearDeath(): void {
    this.deathAnim = null;
  }

  /** Reset all transient juice between rounds so nothing bleeds into the next game. */
  reset(): void {
    this.particles = [];
    this.deathAnim = null;
    this.shakeUntil = 0;
  }
}

/** Best-effort haptic feedback; no-op where unsupported (most desktops). */
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}
