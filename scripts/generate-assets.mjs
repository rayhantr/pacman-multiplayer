/**
 * Generates the committed SEO/PWA image assets in public/ from pure SVG shapes
 * (no external artwork): the social-preview og-image, the PWA icon set, the
 * Apple touch icon, and the favicons.
 *
 * Run with: yarn generate:assets
 *
 * The outputs are committed to the repo, so production builds never need
 * sharp — rerun this script only when the artwork changes.
 *
 * Note: SVG <text> is rasterized with OS-installed fonts (librsvg), so the
 * og-image title intentionally uses Arial/Helvetica (always resolvable on
 * Windows/macOS/Linux) instead of the web app's Inter font.
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Palette — mirrors the design tokens in src/client/styles.css.
const SLATE = '#0f172a';
const BORDER = '#334155';
const TEXT = '#f1f5f9';
const TEXT_MUTED = '#94a3b8';
const AMBER = '#f59e0b';
const GHOST_COLORS = ['#ef4444', '#ec4899', '#22d3ee'];

/** Pac-Man: amber disc with a right-facing mouth wedge and a small eye. */
function pacman(cx, cy, r) {
  const mouth = Math.PI / 6; // half-angle of the mouth opening
  const lipX = cx + r * Math.cos(mouth);
  const upperY = cy - r * Math.sin(mouth);
  const lowerY = cy + r * Math.sin(mouth);
  const eye = `<circle cx="${cx + r * 0.12}" cy="${cy - r * 0.52}" r="${r * 0.11}" fill="${SLATE}"/>`;
  return (
    `<path d="M ${cx} ${cy} L ${lipX} ${upperY} ` +
    `A ${r} ${r} 0 1 0 ${lipX} ${lowerY} Z" fill="${AMBER}"/>` +
    eye
  );
}

/** Classic ghost: dome top, straight sides, three-notch wavy skirt, eyes looking left. */
function ghost(x, y, w, fill) {
  const h = w * 1.15;
  const domeR = w / 2;
  const notch = w * 0.14;
  const seg = w / 6;
  const bottom = y + h;
  const skirt = [5, 4, 3, 2, 1]
    .map((i, idx) => `L ${x + i * seg} ${idx % 2 === 0 ? bottom - notch : bottom}`)
    .join(' ');
  const body =
    `<path d="M ${x} ${bottom} L ${x} ${y + domeR} ` +
    `A ${domeR} ${domeR} 0 0 1 ${x + w} ${y + domeR} ` +
    `L ${x + w} ${bottom} ${skirt} Z" fill="${fill}"/>`;
  const eyeY = y + w * 0.48;
  const eyes = [x + w * 0.32, x + w * 0.68]
    .map(
      ex =>
        `<circle cx="${ex}" cy="${eyeY}" r="${w * 0.13}" fill="#ffffff"/>` +
        `<circle cx="${ex - w * 0.05}" cy="${eyeY}" r="${w * 0.06}" fill="${SLATE}"/>`
    )
    .join('');
  return body + eyes;
}

function pellet(cx, cy, r) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${AMBER}"/>`;
}

/** Square app icon: Pac-Man centered on slate. padFraction controls the safe zone. */
function iconSvg(size, padFraction) {
  const r = (size / 2) * (1 - padFraction);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${SLATE}"/>` +
    pacman(size / 2, size / 2, r) +
    `</svg>`
  );
}

/** 1200x630 social preview: Pac-Man chasing ghosts over a pellet trail, plus the title. */
function ogSvg() {
  const ghostW = 140;
  const ghostY = 180;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">` +
    `<rect width="1200" height="630" fill="${SLATE}"/>` +
    `<rect x="6" y="6" width="1188" height="618" fill="none" stroke="${BORDER}" stroke-width="4"/>` +
    pacman(230, 260, 125) +
    pellet(440, 260, 14) +
    pellet(520, 260, 14) +
    pellet(600, 260, 14) +
    ghost(700, ghostY, ghostW, GHOST_COLORS[0]) +
    ghost(870, ghostY, ghostW, GHOST_COLORS[1]) +
    ghost(1040, ghostY, ghostW, GHOST_COLORS[2]) +
    `<text x="600" y="535" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" ` +
    `font-size="74" font-weight="800" letter-spacing="-1" fill="${TEXT}">Multiplayer Pac-Man</text>` +
    `<text x="600" y="590" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" ` +
    `font-size="30" fill="${TEXT_MUTED}">Free real-time browser game — up to 10 players</text>` +
    `</svg>`
  );
}

async function renderPng(svg, file, { resize, flatten } = {}) {
  let image = sharp(Buffer.from(svg));
  if (resize) image = image.resize(resize, resize);
  if (flatten) image = image.flatten({ background: SLATE });
  await image.png().toFile(join(OUT, file));
  console.log(`  ✓ ${file}`);
}

await mkdir(OUT, { recursive: true });
console.log('Generating SEO/PWA assets in public/ ...');

await renderPng(ogSvg(), 'og-image.png');
await renderPng(iconSvg(512, 0.18), 'icon-512.png');
await renderPng(iconSvg(512, 0.18), 'icon-192.png', { resize: 192 });
// Maskable: artwork inside the central ~60% so Android's mask never clips it.
await renderPng(iconSvg(512, 0.4), 'maskable-512.png');
// Apple touch icon must be fully opaque (iOS composites its own corner rounding).
await renderPng(iconSvg(180, 0.14), 'apple-touch-icon.png', { flatten: true });
await renderPng(iconSvg(32, 0.06), 'favicon-32.png');
await writeFile(join(OUT, 'favicon.svg'), iconSvg(64, 0.06));
console.log('  ✓ favicon.svg');

console.log('Done.');
