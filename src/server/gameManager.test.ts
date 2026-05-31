import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { GameManager } from './gameManager.js';

interface CapturedEmit {
  room: string | null;
  event: string;
  data: any;
}

function createMockIo(): { io: SocketIOServer; emits: CapturedEmit[] } {
  const emits: CapturedEmit[] = [];
  const io = {
    to(room: string) {
      return {
        emit(event: string, data?: unknown) {
          emits.push({ room, event, data });
        },
      };
    },
    emit(event: string, data?: unknown) {
      emits.push({ room: null, event, data });
    },
  };
  return { io: io as unknown as SocketIOServer, emits };
}

function createMockSocket(id: string): { socket: Socket; emitted: CapturedEmit[] } {
  const emitted: CapturedEmit[] = [];
  const socket = {
    id,
    join: () => {},
    emit(event: string, data?: unknown) {
      emitted.push({ room: null, event, data });
    },
  };
  return { socket: socket as unknown as Socket, emitted };
}

/** Returns a deterministic RNG that yields the given values then 0 forever. */
function queuedRandom(values: number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++]! : 0);
}

function eventsOf(emits: CapturedEmit[], event: string): any[] {
  return emits.filter(e => e.event === event).map(e => e.data);
}

function lastEvent(emits: CapturedEmit[], event: string): any | undefined {
  const matches = eventsOf(emits, event);
  return matches[matches.length - 1];
}

describe('GameManager — lobby & roles', () => {
  it('assigns the first joiner Pac-Man and later joiners ghosts with colors', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');

    const p1 = createMockSocket('p1');
    gm.handlePlayerJoin(p1.socket, 'Alice');
    expect(lastEvent(p1.emitted, 'join_success').role).toBe('pacman');

    const p2 = createMockSocket('p2');
    gm.handlePlayerJoin(p2.socket, 'Bob');
    expect(lastEvent(p2.emitted, 'join_success').role).toBe('ghost');

    const joinedP2 = lastEvent(emits, 'player_joined');
    expect(joinedP2.player.role).toBe('ghost');
    expect(joinedP2.player.ghostColor).toBe('red');
    expect(gm.getPlayerCount()).toBe(2);
  });

  it('rejects joins beyond the maximum of ten players', () => {
    const { io } = createMockIo();
    const gm = new GameManager(io, 'room');

    for (let i = 0; i < 10; i++) {
      gm.handlePlayerJoin(createMockSocket(`p${i}`).socket, `P${i}`);
    }
    const overflow = createMockSocket('p10');
    gm.handlePlayerJoin(overflow.socket, 'Late');

    expect(lastEvent(overflow.emitted, 'join_failed').reason).toBe('Game is full');
    expect(gm.getPlayerCount()).toBe(10);
  });

  it('rejects joining after the game has started', () => {
    const { io } = createMockIo();
    const gm = new GameManager(io, 'room');
    gm.handlePlayerJoin(createMockSocket('p1').socket, 'Alice');
    gm.handlePlayerJoin(createMockSocket('p2').socket, 'Bob');
    gm.handleStartGame('p1');

    const late = createMockSocket('p3');
    gm.handlePlayerJoin(late.socket, 'Carol');
    expect(lastEvent(late.emitted, 'join_failed').reason).toBe('Game already started');
  });

  it('reports can_start only once two players are present', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');

    gm.handlePlayerJoin(createMockSocket('p1').socket, 'Alice');
    expect(lastEvent(emits, 'player_joined').can_start).toBe(false);

    gm.handlePlayerJoin(createMockSocket('p2').socket, 'Bob');
    expect(lastEvent(emits, 'player_joined').can_start).toBe(true);
  });

  it('lets a player switch roles and gates start on having both roles', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');
    gm.handlePlayerJoin(createMockSocket('p1').socket, 'Alice'); // pacman (host)
    gm.handlePlayerJoin(createMockSocket('p2').socket, 'Bob'); // ghost

    // Both Pac-Men -> no ghost -> cannot start.
    gm.handleSetRole('p2', 'pacman');
    let changed = lastEvent(emits, 'player_role_changed');
    expect(changed.role).toBe('pacman');
    expect(changed.pacmanColor).toBe('lime'); // second Pac-Man takes slot 1
    expect(changed.can_start).toBe(false);

    // Back to ghost -> one of each -> can start.
    gm.handleSetRole('p2', 'ghost');
    changed = lastEvent(emits, 'player_role_changed');
    expect(changed.can_start).toBe(true);
  });

  it('only lets the host start, and reports start_failed without both roles', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');
    gm.handlePlayerJoin(createMockSocket('p1').socket, 'Alice'); // host
    gm.handlePlayerJoin(createMockSocket('p2').socket, 'Bob');

    // A non-host start attempt is ignored.
    gm.handleStartGame('p2');
    expect(gm.isGameStarted()).toBe(false);

    // Host starting without a ghost (both Pac-Men) is rejected with a reason.
    gm.handleSetRole('p2', 'pacman');
    gm.handleStartGame('p1');
    expect(gm.isGameStarted()).toBe(false);
    expect(lastEvent(emits, 'start_failed').reason).toContain('at least 1');

    // With one of each, the host can start.
    gm.handleSetRole('p2', 'ghost');
    gm.handleStartGame('p1');
    expect(gm.isGameStarted()).toBe(true);
  });
});

describe('GameManager — movement, pellets & cooldown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function startedGame(random?: () => number) {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room', undefined, random);
    gm.handlePlayerJoin(createMockSocket('pac').socket, 'Pac');
    gm.handlePlayerJoin(createMockSocket('gh').socket, 'Ghost');
    gm.handleStartGame('pac');
    emits.length = 0; // discard lobby/start emits
    return { gm, emits };
  }

  function step(gm: GameManager, id: string, dir: 'up' | 'down' | 'left' | 'right'): void {
    vi.advanceTimersByTime(150);
    gm.handlePlayerMove(id, dir);
  }

  it('accepts a valid move and broadcasts player_moved', () => {
    const { gm, emits } = startedGame();
    step(gm, 'pac', 'down'); // (1,1) -> (1,2)
    const moved = lastEvent(emits, 'player_moved');
    expect(moved.player_id).toBe('pac');
    expect(moved.x).toBe(1);
    expect(moved.y).toBe(2);
  });

  it('ignores moves into walls', () => {
    const { gm, emits } = startedGame();
    step(gm, 'pac', 'up'); // (1,1) -> (1,0) is a border wall
    expect(eventsOf(emits, 'player_moved')).toHaveLength(0);
  });

  it('collects a pellet and increases the score by 10', () => {
    const { gm, emits } = startedGame();
    step(gm, 'pac', 'down'); // collects pellet at (1,2)
    const collected = lastEvent(emits, 'pellet_collected');
    expect(collected.score).toBe(10);
  });

  it('throttles moves that arrive faster than the cooldown', () => {
    const { gm, emits } = startedGame();
    gm.handlePlayerMove('pac', 'down'); // accepted (lastMoveAt was 0)
    gm.handlePlayerMove('pac', 'right'); // within cooldown -> ignored
    vi.advanceTimersByTime(150);
    gm.handlePlayerMove('pac', 'right'); // accepted
    expect(eventsOf(emits, 'player_moved')).toHaveLength(2);
  });
});

describe('GameManager — power-ups', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function startedGame(random: () => number) {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room', undefined, random);
    gm.handlePlayerJoin(createMockSocket('pac').socket, 'Pac');
    gm.handlePlayerJoin(createMockSocket('gh').socket, 'Ghost');
    gm.handleStartGame('pac');
    return { gm, emits };
  }

  function step(gm: GameManager, id: string, dir: 'up' | 'down' | 'left' | 'right'): void {
    vi.advanceTimersByTime(150);
    gm.handlePlayerMove(id, dir);
  }

  // Pac-Man pool order: [speed_boost, invincibility, pellet_multiplier, pellet_magnet,
  // pacman_freeze, pacman_phase] (6 items). Ghost pool: [ghost_speed, ghost_freeze,
  // ghost_phase] (3). The first spawn always draws from the Pac-Man pool, the second
  // from the ghost pool, etc. RNG values: [typeFraction, positionFraction] per spawn.

  it('spawns, collects, and applies the pellet multiplier (doubles pellet score)', () => {
    // pellet_multiplier is pool index 2 of 6 -> floor(0.4*6)=2; position index 0 -> (1,1)
    const { gm, emits } = startedGame(queuedRandom([0.4, 0]));

    vi.advanceTimersByTime(15_000); // trigger the (single) first spawn
    const spawned = lastEvent(emits, 'power_up_spawned');
    expect(spawned.type).toBe('pellet_multiplier');
    expect(spawned.owner).toBe('pacman');
    expect(spawned.position).toBe('1,1');

    step(gm, 'pac', 'down'); // (1,1)->(1,2), pellet +10 (no multiplier yet)
    step(gm, 'pac', 'up'); // (1,2)->(1,1), pellet +10 then collects multiplier

    const collected = lastEvent(emits, 'power_up_collected');
    expect(collected.type).toBe('pellet_multiplier');
    expect(collected.position).toBe('1,1');
    // Self-effect is now driven by effect_applied (keyed by effect, not item).
    expect(
      eventsOf(emits, 'effect_applied').some(
        e => e.player_id === 'pac' && e.effect === 'pellet_multiplier'
      )
    ).toBe(true);

    step(gm, 'pac', 'right'); // (1,1)->(2,1), fresh pellet x2 = +20 -> score 40
    const lastPellet = lastEvent(emits, 'pellet_collected');
    expect(lastPellet.score).toBe(40);
  });

  it('expires an effect after its duration and emits effect_expired', () => {
    // invincibility is pool index 1 -> floor(0.25*6)=1; position 0 -> (1,1)
    const { gm, emits } = startedGame(queuedRandom([0.25, 0]));

    vi.advanceTimersByTime(15_000);
    step(gm, 'pac', 'down');
    step(gm, 'pac', 'up'); // collect invincibility at (1,1)
    expect(lastEvent(emits, 'power_up_collected').type).toBe('invincibility');

    vi.advanceTimersByTime(6_000); // invincibility lasts 5s -> a tick expires it

    const expired = lastEvent(emits, 'effect_expired');
    expect(expired.player_id).toBe('pac');
    expect(expired.effect).toBe('invincibility');
  });

  it('emits effect_applied when a player collects a self-effect item', () => {
    // speed_boost is pool index 0 -> floor(0*6)=0; position 0 -> (1,1)
    const { gm, emits } = startedGame(queuedRandom([0, 0]));
    vi.advanceTimersByTime(15_000);
    step(gm, 'pac', 'down');
    step(gm, 'pac', 'up'); // collect speed_boost at (1,1)

    expect(lastEvent(emits, 'power_up_collected').type).toBe('speed_boost');
    expect(
      eventsOf(emits, 'effect_applied').some(e => e.player_id === 'pac' && e.effect === 'speed')
    ).toBe(true);
  });

  it('does not let the opposing role collect a team-tagged item', () => {
    // spawn 1: Pac-Man speed_boost at a far cell. spawn 2: ghost_speed at (1,1).
    const { gm, emits } = startedGame(queuedRandom([0, 0.95, 0, 0]));
    vi.advanceTimersByTime(15_000); // spawn 1 (Pac-Man item, far)
    vi.advanceTimersByTime(15_000); // spawn 2 (ghost item at 1,1)
    expect(eventsOf(emits, 'power_up_spawned').some(s => s.type === 'ghost_speed')).toBe(true);

    emits.length = 0;
    step(gm, 'pac', 'down'); // leave (1,1)
    step(gm, 'pac', 'up'); // step back onto the ghost item — must NOT collect it

    expect(eventsOf(emits, 'power_up_collected')).toHaveLength(0);
    expect(eventsOf(emits, 'effect_applied').filter(e => e.player_id === 'pac')).toHaveLength(0);
  });

  it('freezes the opposing team, blocking their moves until it expires', () => {
    // pacman_freeze is pool index 4 -> floor(0.7*6)=4; position 0 -> (1,1)
    const { gm, emits } = startedGame(queuedRandom([0.7, 0]));
    vi.advanceTimersByTime(15_000);
    step(gm, 'pac', 'down');
    step(gm, 'pac', 'up'); // collect pacman_freeze -> all ghosts frozen
    expect(
      eventsOf(emits, 'effect_applied').some(e => e.player_id === 'gh' && e.effect === 'frozen')
    ).toBe(true);

    // A frozen ghost cannot move.
    emits.length = 0;
    step(gm, 'gh', 'left');
    expect(eventsOf(emits, 'player_moved').filter(m => m.player_id === 'gh')).toHaveLength(0);

    // After the freeze elapses (2.5s), a tick clears it and the ghost moves again.
    vi.advanceTimersByTime(3_000);
    expect(
      eventsOf(emits, 'effect_expired').some(e => e.player_id === 'gh' && e.effect === 'frozen')
    ).toBe(true);
    emits.length = 0;
    step(gm, 'gh', 'left');
    expect(eventsOf(emits, 'player_moved').some(m => m.player_id === 'gh')).toBe(true);
  });

  it('lets a phasing player move through walls and relocates it when phase ends in a wall', () => {
    // pacman_phase is pool index 5 -> floor(0.9*6)=5; position 0 -> (1,1)
    const { gm, emits } = startedGame(queuedRandom([0.9, 0]));
    vi.advanceTimersByTime(15_000);
    step(gm, 'pac', 'down');
    step(gm, 'pac', 'up'); // collect pacman_phase at (1,1)

    // (1,0) is a border wall; phasing lets Pac-Man step onto it.
    step(gm, 'pac', 'up');
    const wallMove = lastEvent(emits, 'player_moved');
    expect(wallMove.player_id).toBe('pac');
    expect(wallMove.x).toBe(1);
    expect(wallMove.y).toBe(0);

    // Let phase (3s) elapse while standing in the wall -> relocate to (1,1).
    emits.length = 0;
    vi.advanceTimersByTime(5_000);
    expect(
      eventsOf(emits, 'effect_expired').some(e => e.player_id === 'pac' && e.effect === 'phase')
    ).toBe(true);
    const relocate = eventsOf(emits, 'player_moved').find(
      m => m.player_id === 'pac' && m.x === 1 && m.y === 1
    );
    expect(relocate).toBeDefined();
  });

  it('vacuums surrounding pellets while the magnet is active', () => {
    // pellet_magnet is pool index 3 -> floor(0.55*6)=3; position 0 -> (1,1)
    const { gm, emits } = startedGame(queuedRandom([0.55, 0]));
    vi.advanceTimersByTime(15_000);
    step(gm, 'pac', 'down');
    step(gm, 'pac', 'up'); // collect pellet_magnet at (1,1)

    emits.length = 0;
    step(gm, 'pac', 'down'); // one move: magnet sweeps the surrounding ring
    // More than one pellet collected in a single step proves the radius sweep.
    expect(eventsOf(emits, 'pellet_collected').length).toBeGreaterThan(1);
  });

  it('lets a ghost collect ghost_speed and then move at the boosted cadence', () => {
    // spawn 1: Pac-Man item (far). spawn 2: ghost_speed (index 0) at (1,1).
    const { gm, emits } = startedGame(queuedRandom([0, 0.95, 0, 0]));
    // Move Pac-Man off row 1 so the ghost can reach (1,1) without a collision.
    step(gm, 'pac', 'down'); // (1,1)->(1,2)
    step(gm, 'pac', 'down'); // (1,2)->(1,3)

    vi.advanceTimersByTime(15_000); // spawn 1
    vi.advanceTimersByTime(15_000); // spawn 2: ghost_speed at (1,1)
    expect(eventsOf(emits, 'power_up_spawned').some(s => s.type === 'ghost_speed')).toBe(true);

    // Walk the ghost left along row 1 onto (1,1) to collect it.
    for (let i = 0; i < 20; i++) {
      step(gm, 'gh', 'left');
      if (eventsOf(emits, 'power_up_collected').some(c => c.type === 'ghost_speed')) {
        break;
      }
    }
    expect(
      eventsOf(emits, 'effect_applied').some(e => e.player_id === 'gh' && e.effect === 'speed')
    ).toBe(true);

    // Boosted cooldown is 65ms; two moves 70ms apart are both accepted (base 130 would throttle).
    emits.length = 0;
    vi.advanceTimersByTime(70);
    gm.handlePlayerMove('gh', 'right');
    vi.advanceTimersByTime(70);
    gm.handlePlayerMove('gh', 'right');
    expect(eventsOf(emits, 'player_moved').filter(m => m.player_id === 'gh')).toHaveLength(2);
  });

  it('clears frozen (and other effects) on restart', () => {
    const { gm, emits } = startedGame(queuedRandom([0.7, 0])); // pacman_freeze at (1,1)
    vi.advanceTimersByTime(15_000);
    step(gm, 'pac', 'down');
    step(gm, 'pac', 'up'); // ghost frozen
    expect(
      eventsOf(emits, 'effect_applied').some(e => e.player_id === 'gh' && e.effect === 'frozen')
    ).toBe(true);

    gm.handleRestartGame('pac');
    gm.handleStartGame('pac');
    emits.length = 0;
    step(gm, 'gh', 'left'); // ghost is reset -> no longer frozen
    expect(eventsOf(emits, 'player_moved').some(m => m.player_id === 'gh')).toBe(true);
  });
});

describe('GameManager — collisions & end states', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function startedGame(random?: () => number) {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room', undefined, random);
    gm.handlePlayerJoin(createMockSocket('pac').socket, 'Pac'); // spawns at (1,1)
    gm.handlePlayerJoin(createMockSocket('gh').socket, 'Ghost'); // spawns at (18,1)
    gm.handleStartGame('pac');
    return { gm, emits };
  }

  function step(gm: GameManager, id: string, dir: 'up' | 'down' | 'left' | 'right'): void {
    vi.advanceTimersByTime(150);
    gm.handlePlayerMove(id, dir);
  }

  it('ends the game for the ghosts when a ghost catches Pac-Man', () => {
    const { gm, emits } = startedGame();
    // Row y=1 is a clear corridor; walk the ghost left from (18,1) onto Pac-Man (1,1).
    for (let i = 0; i < 20 && !gm.isGameOver(); i++) {
      step(gm, 'gh', 'left');
    }
    expect(gm.isGameOver()).toBe(true);
    expect(lastEvent(emits, 'game_over').winner).toBe('ghosts');
  });

  it('lets an invincible Pac-Man eat a ghost instead of losing', () => {
    // invincibility is Pac-Man pool index 1 -> floor(0.25*6)=1; position 0 -> (1,1)
    const { gm, emits } = startedGame(queuedRandom([0.25, 0]));
    vi.advanceTimersByTime(15_000);
    step(gm, 'pac', 'down');
    step(gm, 'pac', 'up'); // collect invincibility, Pac-Man back at (1,1)
    emits.length = 0;

    for (let i = 0; i < 20 && !gm.isGameOver(); i++) {
      step(gm, 'gh', 'left');
    }

    expect(gm.isGameOver()).toBe(false);
    const respawn = eventsOf(emits, 'player_moved').find(
      m => m.player_id === 'gh' && m.x === 18 && m.y === 1
    );
    expect(respawn).toBeDefined();
    expect(respawn.score).toBeGreaterThanOrEqual(200);
  });

  it('ends the game for the ghosts when Pac-Man leaves mid-game', () => {
    const { gm, emits } = startedGame();
    gm.handleLeaveGame('pac');
    expect(gm.isGameOver()).toBe(true);
    expect(lastEvent(emits, 'game_over').winner).toBe('ghosts');
  });

  it('converts a caught Pac-Man to a ghost without ending the game while others remain', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room', undefined);
    gm.handlePlayerJoin(createMockSocket('pac1').socket, 'Pac1'); // pacman slot0 (1,1)
    gm.handlePlayerJoin(createMockSocket('gh').socket, 'Ghost'); // ghost slot0 (18,1)
    gm.handlePlayerJoin(createMockSocket('pac2').socket, 'Pac2'); // ghost slot1...
    gm.handleSetRole('pac2', 'pacman'); // ...promoted to pacman slot1 (1,9), off row 1
    gm.handleStartGame('pac1');

    // Ghost walks the clear y=1 corridor onto Pac1 at (1,1).
    for (let i = 0; i < 20 && !gm.isGameOver(); i++) {
      vi.advanceTimersByTime(150);
      gm.handlePlayerMove('gh', 'left');
    }

    // Pac1 was converted, but Pac2 still plays -> game continues.
    expect(eventsOf(emits, 'player_converted').some(e => e.player_id === 'pac1')).toBe(true);
    expect(gm.isGameOver()).toBe(false);
  });

  it('removes a board boost that is never collected after its lifetime', () => {
    // spawn 1: Pac-Man invincibility at (1,1). spawn 2 (at 30s): ghost item at a far cell
    // so it doesn't overwrite (1,1) before the first item ages out.
    const { emits } = startedGame(queuedRandom([0.25, 0, 0, 0.95]));
    vi.advanceTimersByTime(15_000); // first spawn
    const spawned = lastEvent(emits, 'power_up_spawned');
    expect(spawned.position).toBe('1,1');

    emits.length = 0;
    vi.advanceTimersByTime(20_000); // sit uncollected past POWER_UP_LIFETIME_MS (20s)
    expect(eventsOf(emits, 'power_up_despawned').some(d => d.position === '1,1')).toBe(true);
  });
});

describe('GameManager — maps, caps & colors', () => {
  function join(gm: GameManager, id: string, name: string, role?: 'pacman' | 'ghost') {
    const sock = createMockSocket(id);
    gm.handlePlayerJoin(sock.socket, name, role);
    return sock;
  }

  it('honors a requested join role and falls back when that role is full', () => {
    const { io } = createMockIo();
    const gm = new GameManager(io, 'room');

    // First joiner explicitly picks ghost (host need not be Pac-Man).
    const first = join(gm, 'p0', 'P0', 'ghost');
    expect(lastEvent(first.emitted, 'join_success').role).toBe('ghost');

    // Fill Pac-Man to its cap of six, then a seventh request falls back to ghost.
    for (let i = 1; i <= 6; i++) {
      const s = join(gm, `p${i}`, `P${i}`, 'pacman');
      expect(lastEvent(s.emitted, 'join_success').role).toBe('pacman');
    }
    const overflow = join(gm, 'p7', 'P7', 'pacman');
    expect(lastEvent(overflow.emitted, 'join_success').role).toBe('ghost');
  });

  it('blocks a role switch that would exceed the role cap', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');

    join(gm, 'p0', 'P0', 'pacman');
    for (let i = 1; i <= 5; i++) {
      join(gm, `p${i}`, `P${i}`, 'pacman'); // six Pac-Men total (the cap)
    }
    const ghost = join(gm, 'p6', 'P6', 'ghost');

    emits.length = 0;
    gm.handleSetRole('p6', 'pacman');

    expect(emits.some(e => e.event === 'role_change_failed' && e.room === 'p6')).toBe(true);
    expect(eventsOf(emits, 'player_role_changed').some(e => e.player_id === 'p6')).toBe(false);
    // The blocked player stays a ghost (its join color is unchanged).
    expect(lastEvent(ghost.emitted, 'join_success').role).toBe('ghost');
  });

  it('lets a waiting player pick any color from their role palette', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');
    join(gm, 'p0', 'P0', 'pacman');

    gm.handleSetColor('p0', 'teal');
    const changed = lastEvent(emits, 'player_color_changed');
    expect(changed.player_id).toBe('p0');
    expect(changed.pacmanColor).toBe('teal');
    expect(changed.ghostColor).toBeNull();
  });

  it("ignores a color that is not in the player's role palette", () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');
    join(gm, 'p0', 'P0', 'pacman');

    emits.length = 0;
    gm.handleSetColor('p0', 'red'); // red is a ghost color, invalid for a Pac-Man
    expect(eventsOf(emits, 'player_color_changed')).toHaveLength(0);
  });

  it('selects the most-voted unlocked map, defaulting to Classic with no votes', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');
    join(gm, 'p0', 'P0', 'pacman');
    join(gm, 'p1', 'P1', 'ghost');

    // No votes yet -> the default (Classic) leads.
    expect(lastEvent(emits, 'lobby_map_state').selectedMapId).toBe('classic');

    gm.handleVoteMap('p0', 'sprawl');
    gm.handleVoteMap('p1', 'sprawl');
    expect(lastEvent(emits, 'lobby_map_state').selectedMapId).toBe('sprawl');
  });

  it('ignores votes for a map locked by the current head-count', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');
    // "cozy" caps at four players; seat five so it is locked.
    join(gm, 'p0', 'P0', 'pacman');
    for (let i = 1; i <= 4; i++) {
      join(gm, `p${i}`, `P${i}`, 'ghost');
    }

    emits.length = 0;
    gm.handleVoteMap('p0', 'cozy');
    expect(eventsOf(emits, 'lobby_map_state')).toHaveLength(0); // vote ignored, no resync
  });

  it('plays the voted map and ships its board with game_started', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');
    join(gm, 'p0', 'P0', 'pacman');
    join(gm, 'p1', 'P1', 'ghost');

    gm.handleVoteMap('p0', 'grand');
    gm.handleVoteMap('p1', 'grand');
    gm.handleStartGame('p0');

    // "grand" is 25x23 (the default Classic is 20x19), proving the swap happened.
    const started = lastEvent(emits, 'game_started');
    expect(started.game_state.maze[0].length).toBe(25);
    expect(started.game_state.maze.length).toBe(23);
  });
});

describe('GameManager — restart', () => {
  it('resets pellets and score on restart', () => {
    const { io, emits } = createMockIo();
    const gm = new GameManager(io, 'room');
    const pac = createMockSocket('pac');
    gm.handlePlayerJoin(pac.socket, 'Pac');
    gm.handlePlayerJoin(createMockSocket('gh').socket, 'Ghost');
    const initialPellets = lastEvent(pac.emitted, 'join_success').game_state.pelletsRemaining;

    gm.handleStartGame('pac');
    gm.handlePlayerMove('pac', 'down'); // collect a pellet
    emits.length = 0;

    gm.handleRestartGame('pac');
    const restarted = lastEvent(emits, 'game_restarted');
    expect(restarted.game_state.pelletsRemaining).toBe(initialPellets);
    expect(restarted.game_state.score).toBe(0);
  });
});
