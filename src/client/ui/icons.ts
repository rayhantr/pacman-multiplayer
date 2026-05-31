/**
 * Single source of truth for UI icons. DOM icons are built as inline <svg> in
 * the shared Lucide/Feather stroke style (viewBox 0 0 24 24, stroke=currentColor)
 * to match the HUD stat icons already hardcoded in index.html. Board glyphs drawn
 * on the canvas reuse the same shapes as Path2D path data (see ICON_CANVAS_PATHS).
 */

import type { EffectType, PowerUpType } from '../../shared/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inner SVG markup per icon name (Lucide/Feather style on a 24px grid). */
export const ICON_PATHS: Record<string, string> = {
  // Effect / power-up icons — shared by the HUD timer chips and the help legend.
  speed: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  invincibility: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  pellet_multiplier: '<circle cx="9" cy="9" r="6"/><path d="M21 15a6 6 0 0 1-9 5.2"/>',
  magnet: '<path d="M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4Z"/>',
  phase: '<path d="M5 21V9a7 7 0 0 1 14 0v12l-2.5-2-2.5 2-2-2-2 2-2.5-2L5 21Z"/>',
  frozen: '<path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1"/>',

  // Chrome icons — controls.
  'volume-on':
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  'volume-off':
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  'arrow-up': '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  'log-out':
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',

  // Role icons — drawn as solid filled silhouettes (pass { filled: true }).
  pacman: '<path d="M12 12 L20.66 7 A10 10 0 1 0 20.66 17 Z"/>',
  ghost: '<path d="M3 11 A9 9 0 0 1 21 11 L21 21 18 18 15 21 12 18 9 21 6 18 3 21 Z"/>',
};

export interface IconOptions {
  /** Render a solid filled silhouette (fill=currentColor) instead of a stroke. */
  filled?: boolean;
}

/** Build an inline <svg> icon element in the shared stroke (or filled) style. */
export function createIcon(
  name: string,
  className?: string,
  opts: IconOptions = {}
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (className) {
    svg.setAttribute('class', className);
  }
  if (opts.filled) {
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('stroke', 'none');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  svg.innerHTML = ICON_PATHS[name] ?? '';
  return svg;
}

/**
 * Replace every [data-icon] placeholder in `root` with its inline SVG. Lets the
 * static index.html carry placeholders while all path data lives here. Honors
 * data-icon-class (copied onto the <svg>) and the presence of data-icon-filled.
 */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => {
    const name = el.dataset['icon'];
    if (!name) {
      return;
    }
    const svg = createIcon(name, el.dataset['iconClass'], {
      filled: 'iconFilled' in el.dataset,
    });
    el.replaceWith(svg);
  });
}

/** Maps each board power-up item to its visual effect family (for canvas glyphs). */
export const POWERUP_EFFECT: Record<PowerUpType, EffectType> = {
  speed_boost: 'speed',
  ghost_speed: 'speed',
  invincibility: 'invincibility',
  pellet_multiplier: 'pellet_multiplier',
  pellet_magnet: 'magnet',
  pacman_freeze: 'frozen',
  ghost_freeze: 'frozen',
  pacman_phase: 'phase',
  ghost_phase: 'phase',
};

/**
 * Path-only `d` strings per effect family for drawing the same glyphs on the
 * canvas via Path2D. The DOM <circle>/multi-segment markup above can't feed a
 * single Path2D, so these are path-equivalent variants (circle approximated as
 * arcs, snowflake as separate segments).
 */
export const ICON_CANVAS_PATHS: Record<EffectType, string[]> = {
  speed: ['M13 2 4 14h6l-1 8 9-12h-6l1-8Z'],
  invincibility: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z'],
  pellet_multiplier: ['M3 9a6 6 0 1 0 12 0 6 6 0 1 0-12 0', 'M21 15a6 6 0 0 1-9 5.2'],
  magnet: ['M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4Z'],
  phase: ['M5 21V9a7 7 0 0 1 14 0v12l-2.5-2-2.5 2-2-2-2 2-2.5-2L5 21Z'],
  frozen: ['M12 2v20', 'M2 12h20', 'M4.9 4.9l14.2 14.2', 'M19.1 4.9 4.9 19.1'],
};
