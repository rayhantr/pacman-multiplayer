import { describe, it, expect } from 'vitest';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { RoomManager } from './roomManager.js';

interface CapturedEmit {
  event: string;
  data: any;
}

function createMockIo(): { io: SocketIOServer; broadcasts: CapturedEmit[] } {
  const broadcasts: CapturedEmit[] = [];
  const io = {
    to() {
      return { emit() {} };
    },
    emit(event: string, data?: unknown) {
      broadcasts.push({ event, data });
    },
  };
  return { io: io as unknown as SocketIOServer, broadcasts };
}

function createMockSocket(id: string): { socket: Socket; emitted: CapturedEmit[] } {
  const emitted: CapturedEmit[] = [];
  const socket = {
    id,
    join: () => {},
    emit(event: string, data?: unknown) {
      emitted.push({ event, data });
    },
  };
  return { socket: socket as unknown as Socket, emitted };
}

describe('RoomManager', () => {
  it('creates a default room on construction', () => {
    const { io } = createMockIo();
    const rm = new RoomManager(io);

    const rooms = rm.getRoomsList();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({
      id: 'room_default',
      name: 'Default Room',
      playerCount: 0,
      maxPlayers: 10,
      isStarted: false,
      isGameOver: false,
    });
  });

  it('creates a custom room, joins the creator, and confirms it', () => {
    const { io } = createMockIo();
    const rm = new RoomManager(io);
    const host = createMockSocket('host');

    rm.createRoom(host.socket, 'Alice', 'MyRoom');

    const myRoom = rm.getRoomsList().find(r => r.name === 'MyRoom');
    expect(myRoom).toBeDefined();
    expect(myRoom!.playerCount).toBe(1);
    expect(host.emitted.find(e => e.event === 'room_created')?.data.roomName).toBe('MyRoom');
  });

  it('resolves room codes (default, custom name, and unknown)', () => {
    const { io } = createMockIo();
    const rm = new RoomManager(io);
    rm.createRoom(createMockSocket('host').socket, 'Alice', 'MyRoom');

    expect(rm.findRoomByCode('default')).toBe('room_default');
    expect(rm.findRoomByCode('')).toBe('room_default');
    expect(rm.findRoomByCode('MyRoom')).toBe('room_1');
    expect(rm.findRoomByCode('Unknown')).toBeNull();
  });

  it('matches room codes case-insensitively and ignores surrounding whitespace', () => {
    const { io } = createMockIo();
    const rm = new RoomManager(io);
    rm.createRoom(createMockSocket('host').socket, 'Alice', 'MyRoom');

    expect(rm.findRoomByCode('myroom')).toBe('room_1');
    expect(rm.findRoomByCode('MYROOM')).toBe('room_1');
    expect(rm.findRoomByCode('  MyRoom  ')).toBe('room_1');
    // The default room stays reachable regardless of case.
    expect(rm.findRoomByCode('DEFAULT')).toBe('room_default');
    // Unknown codes still return null.
    expect(rm.findRoomByCode('nope')).toBeNull();
  });

  it('rejects joining an unknown room code', () => {
    const { io } = createMockIo();
    const rm = new RoomManager(io);
    const player = createMockSocket('p1');

    rm.joinRoomByCode(player.socket, 'Bob', 'Nope');

    const failure = player.emitted.find(e => e.event === 'join_failed');
    expect(failure?.data.reason).toContain('not found');
  });

  it('deletes empty non-default rooms but keeps the default room', () => {
    const { io } = createMockIo();
    const rm = new RoomManager(io);

    rm.createRoom(createMockSocket('host').socket, 'Alice', 'RoomA');
    expect(rm.getRoomsList().some(r => r.name === 'RoomA')).toBe(true);

    rm.leaveRoom('host');
    expect(rm.getRoomsList().some(r => r.name === 'RoomA')).toBe(false);

    // Default room survives even when empty.
    const guest = createMockSocket('guest');
    rm.joinRoom(guest.socket, 'Bob');
    rm.leaveRoom('guest');
    expect(rm.getRoomsList().some(r => r.id === 'room_default')).toBe(true);
  });

  it('broadcasts the rooms list when a room is created', () => {
    const { io, broadcasts } = createMockIo();
    const rm = new RoomManager(io);

    rm.createRoom(createMockSocket('host').socket, 'Alice', 'MyRoom');

    expect(broadcasts.some(b => b.event === 'rooms_list')).toBe(true);
  });

  it('cleans up a disconnected player', () => {
    const { io } = createMockIo();
    const rm = new RoomManager(io);
    rm.createRoom(createMockSocket('host').socket, 'Alice', 'RoomA');

    rm.handlePlayerDisconnect('host');
    expect(rm.getRoomsList().some(r => r.name === 'RoomA')).toBe(false);
  });
});
