/**
 * Map catalog — the single source of truth for the playable boards, shared by
 * the server (authoritative board + spawns) and the client (lobby vote panel).
 *
 * Each board uses an *isolated-pillar* wall pattern (no full wall lines), which
 * keeps every path cell reachable so a Pac-Man can always clear the pellets.
 * Spawns are chosen by farthest-point sampling so players start spread out.
 */
import type { MapInfo, MapSize, Position } from './types.js';

export interface GameMap extends MapInfo {
  readonly grid: readonly (readonly number[])[];
  readonly pacmanSpawns: readonly Position[];
  readonly ghostSpawns: readonly Position[];
}

type Grid = number[][];

/** Build a bordered grid; `wall(x,y)` decides interior pillars (1 = wall, 0 = path). */
function buildGrid(width: number, height: number, wall: (x: number, y: number) => boolean): Grid {
  const grid: Grid = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      const border = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      grid[y]![x] = border || wall(x, y) ? 1 : 0;
    }
  }
  return grid;
}

/** The original procedurally-generated board, with its spawn-area clear preserved. */
function classicGrid(): Grid {
  const grid = buildGrid(
    20,
    19,
    (x, y) => (x % 4 === 0 && y % 4 === 0) || (x % 6 === 0 && y % 3 === 0)
  );
  // Keep the original top-left spawn pocket clear.
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      grid[y]![x] = 0;
    }
  }
  return grid;
}

function walkableCells(grid: readonly (readonly number[])[]): Position[] {
  const cells: Position[] = [];
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x++) {
      if (row[x] === 0) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

/**
 * Pick `count` walkable cells spread across the board (farthest-point sampling),
 * skipping anything in `exclude` so the two role pools never overlap, and keeping
 * picks as far as possible from `avoid` (the other role's spawns) as well as from
 * each other. Returns fewer than `count` only if the board genuinely lacks room.
 */
function pickSpawns(
  grid: readonly (readonly number[])[],
  count: number,
  exclude: ReadonlySet<string> = new Set(),
  avoid: readonly Position[] = []
): Position[] {
  const candidates = walkableCells(grid).filter(c => !exclude.has(`${c.x},${c.y}`));
  const chosen: Position[] = [];
  if (candidates.length === 0) {
    return chosen;
  }
  // Anchors are the points new picks should stay away from. With no role to avoid
  // (the first pool), seed deterministically from the first candidate; otherwise
  // every pick — including the first — is driven away from the other role's spawns.
  const anchors: Position[] = [...avoid];
  if (anchors.length === 0) {
    chosen.push(candidates[0]!);
    anchors.push(candidates[0]!);
  }
  while (chosen.length < count && chosen.length < candidates.length) {
    let best: Position | null = null;
    let bestDist = -1;
    for (const c of candidates) {
      if (chosen.some(p => p.x === c.x && p.y === c.y)) {
        continue;
      }
      let nearest = Infinity;
      for (const p of anchors) {
        const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
        if (d < nearest) {
          nearest = d;
        }
      }
      if (nearest > bestDist) {
        bestDist = nearest;
        best = c;
      }
    }
    if (!best) {
      break;
    }
    chosen.push(best);
    anchors.push(best);
  }
  return chosen;
}

/** Build a non-Classic map: grid from a pillar pattern, spawns by sampling. */
function makeMap(info: MapInfo, wall: (x: number, y: number) => boolean): GameMap {
  const grid = buildGrid(info.width, info.height, wall);
  const pacmanSpawns = pickSpawns(grid, MAX_SPAWNS);
  const exclude = new Set(pacmanSpawns.map(s => `${s.x},${s.y}`));
  // Seed ghosts away from the Pac-Man spawns so the two teams don't start adjacent.
  const ghostSpawns = pickSpawns(grid, MAX_SPAWNS, exclude, pacmanSpawns);
  return { ...info, grid, pacmanSpawns, ghostSpawns };
}

/** Big maps must seat up to the room cap of either role. */
const MAX_SPAWNS = 6;

const CLASSIC: GameMap = {
  id: 'classic',
  name: 'Classic',
  size: 'big',
  width: 20,
  height: 19,
  maxPlayers: 10,
  grid: classicGrid(),
  // Hand-fixed so the first slots match the historical spawn coordinates.
  pacmanSpawns: [
    { x: 1, y: 1 },
    { x: 1, y: 9 },
    { x: 9, y: 1 },
    { x: 17, y: 1 },
    { x: 9, y: 17 },
    { x: 17, y: 17 },
  ],
  ghostSpawns: [
    { x: 18, y: 1 },
    { x: 1, y: 17 },
    { x: 18, y: 17 },
    { x: 9, y: 9 },
    { x: 5, y: 5 },
    { x: 13, y: 13 },
  ],
};

export const GAME_MAPS: readonly GameMap[] = [
  CLASSIC,
  makeMap(
    { id: 'sprawl', name: 'Sprawl', size: 'big', width: 23, height: 21, maxPlayers: 10 },
    (x, y) => x % 2 === 0 && y % 2 === 0
  ),
  makeMap(
    { id: 'grand', name: 'Grand', size: 'big', width: 25, height: 23, maxPlayers: 10 },
    (x, y) => x % 3 === 0 && y % 2 === 0
  ),
  makeMap(
    { id: 'cozy', name: 'Cozy', size: 'small', width: 13, height: 11, maxPlayers: 4 },
    (x, y) => x % 2 === 0 && y % 2 === 0
  ),
  makeMap(
    { id: 'alley', name: 'Alley', size: 'small', width: 15, height: 11, maxPlayers: 6 },
    (x, y) => x % 4 === 0 && y % 2 === 0
  ),
  makeMap(
    { id: 'box', name: 'Box', size: 'small', width: 15, height: 13, maxPlayers: 8 },
    (x, y) => x % 2 === 0 && y % 3 === 0
  ),
];

export const DEFAULT_MAP_ID = 'classic';

const MAP_BY_ID = new Map(GAME_MAPS.map(m => [m.id, m]));

export function getMap(id: string): GameMap {
  return MAP_BY_ID.get(id) ?? CLASSIC;
}

export function mapInfos(): MapInfo[] {
  return GAME_MAPS.map(({ id, name, size, width, height, maxPlayers }) => ({
    id,
    name,
    size,
    width,
    height,
    maxPlayers,
  }));
}

/** A map is locked once the room holds more players than it can seat. */
export function isMapLocked(map: { readonly maxPlayers: number }, playerCount: number): boolean {
  return playerCount > map.maxPlayers;
}

export type { MapSize };
