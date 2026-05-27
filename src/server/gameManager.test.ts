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

  it('rejects joins beyond the maximum of five players', () => {
    const { io } = createMockIo();
    const gm = new GameManager(io, 'room');

    for (let i = 0; i < 5; i++) {
      gm.handlePlayerJoin(createMockSocket(`p${i}`).socket, `P${i}`);
    }
    const overflow = createMockSocket('p5');
    gm.handlePlayerJoin(overflow.socket, 'Late');

    expect(lastEvent(overflow.emitted, 'join_failed').reason).toBe('Game is full');
    expect(gm.getPlayerCount()).toBe(5);
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

  it('spawns, collects, and applies the pellet multiplier (doubles pellet score)', () => {
    // type index 2 (pellet_multiplier), position index 0 (cell 1,1 = Pac-Man's spawn)
    const { gm, emits } = startedGame(queuedRandom([0.7, 0]));

    vi.advanceTimersByTime(30_000); // trigger the spawn timer
    const spawned = lastEvent(emits, 'power_up_spawned');
    expect(spawned.type).toBe('pellet_multiplier');
    expect(spawned.position).toBe('1,1');

    step(gm, 'pac', 'down'); // (1,1)->(1,2), pellet +10 (no multiplier yet)
    step(gm, 'pac', 'up'); // (1,2)->(1,1), pellet +10 then collects multiplier

    const collected = lastEvent(emits, 'power_up_collected');
    expect(collected.type).toBe('pellet_multiplier');
    expect(collected.position).toBe('1,1');

    step(gm, 'pac', 'right'); // (1,1)->(2,1), fresh pellet x2 = +20 -> score 40
    const lastPellet = lastEvent(emits, 'pellet_collected');
    expect(lastPellet.score).toBe(40);
  });

  it('expires an effect after its duration and emits power_up_expired', () => {
    // type index 1 (invincibility), position index 0 (cell 1,1)
    const { gm, emits } = startedGame(queuedRandom([0.4, 0]));

    vi.advanceTimersByTime(30_000);
    step(gm, 'pac', 'down');
    step(gm, 'pac', 'up'); // collect invincibility at (1,1)
    expect(lastEvent(emits, 'power_up_collected').type).toBe('invincibility');

    vi.advanceTimersByTime(6_000); // invincibility lasts 5s
    gm.handlePlayerMove('pac', 'right'); // triggers expireEffects

    const expired = lastEvent(emits, 'power_up_expired');
    expect(expired.player_id).toBe('pac');
    expect(expired.type).toBe('invincibility');
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
    // invincibility spawned at (1,1)
    const { gm, emits } = startedGame(queuedRandom([0.4, 0]));
    vi.advanceTimersByTime(30_000);
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
