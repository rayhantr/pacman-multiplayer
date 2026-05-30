import type { Server as SocketIOServer, Socket } from 'socket.io';
import { GameManager } from './gameManager.js';
import type { Direction, RoomInfo } from './types.js';

const DEFAULT_ROOM_ID = 'room_default';
const MAX_PLAYERS_PER_ROOM = 5;

export class RoomManager {
  private readonly io: SocketIOServer;
  private readonly rooms = new Map<string, GameManager>();
  private readonly roomNames = new Map<string, string>(); // roomId -> custom name
  private readonly playerRooms = new Map<string, string>(); // socketId -> roomId
  private roomCounter = 0;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.createDefaultRoom();
  }

  private createGameManager(roomId: string): GameManager {
    // The callback keeps the lobby room list live: any state change inside a
    // room (join/leave/start/restart/game-over) rebroadcasts the list.
    return new GameManager(this.io, roomId, () => this.broadcastRoomsList());
  }

  private createDefaultRoom(): void {
    this.rooms.set(DEFAULT_ROOM_ID, this.createGameManager(DEFAULT_ROOM_ID));
    this.roomNames.set(DEFAULT_ROOM_ID, 'Default Room');
    console.log('📦 Default room created:', DEFAULT_ROOM_ID);
  }

  public createRoom(socket: Socket, playerName: string, roomName: string): void {
    this.roomCounter++;
    const roomId = `room_${this.roomCounter}`;

    this.rooms.set(roomId, this.createGameManager(roomId));
    this.roomNames.set(roomId, roomName);

    console.log(`📦 Room created: ${roomId} (${roomName}) by ${playerName}`);

    // Join the creator to the room.
    this.joinRoom(socket, playerName, roomId);

    socket.emit('room_created', { roomId, roomName });
    this.broadcastRoomsList();
  }

  public joinRoom(socket: Socket, playerName: string, roomId?: string): void {
    const targetRoomId = roomId ?? DEFAULT_ROOM_ID;
    const gameManager = this.rooms.get(targetRoomId);

    if (!gameManager) {
      socket.emit('join_failed', { reason: 'Room not found' });
      return;
    }

    // Remove the player from a previous room if necessary.
    if (this.playerRooms.has(socket.id)) {
      this.leaveRoom(socket.id);
    }

    this.playerRooms.set(socket.id, targetRoomId);
    void socket.join(targetRoomId);

    gameManager.handlePlayerJoin(socket, playerName);
  }

  public leaveRoom(socketId: string): void {
    this.removeFromRoom(socketId, false);
  }

  public handlePlayerDisconnect(socketId: string): void {
    this.removeFromRoom(socketId, true);
  }

  /** Shared cleanup for both explicit leave and disconnect. */
  private removeFromRoom(socketId: string, dueToDisconnect: boolean): void {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) {
      return;
    }

    const gameManager = this.rooms.get(roomId);
    if (gameManager) {
      if (dueToDisconnect) {
        gameManager.handlePlayerDisconnect(socketId);
      } else {
        gameManager.handleLeaveGame(socketId);
      }
    }

    this.playerRooms.delete(socketId);

    // Clean up empty non-default rooms.
    if (roomId !== DEFAULT_ROOM_ID && gameManager?.getPlayerCount() === 0) {
      this.rooms.delete(roomId);
      this.roomNames.delete(roomId);
      console.log(`📦 Empty room deleted: ${roomId}`);
    }

    this.broadcastRoomsList();
  }

  public handlePlayerMove(socketId: string, direction: Direction): void {
    this.withRoom(socketId, gameManager => gameManager.handlePlayerMove(socketId, direction));
  }

  public handleSetRole(socketId: string, role: 'pacman' | 'ghost'): void {
    this.withRoom(socketId, gameManager => gameManager.handleSetRole(socketId, role));
  }

  public handleStartGame(socketId: string): void {
    this.withRoom(socketId, gameManager => gameManager.handleStartGame(socketId));
  }

  public handleRestartGame(socketId: string): void {
    this.withRoom(socketId, gameManager => gameManager.handleRestartGame(socketId));
  }

  private withRoom(socketId: string, action: (gameManager: GameManager) => void): void {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) {
      return;
    }
    const gameManager = this.rooms.get(roomId);
    if (gameManager) {
      action(gameManager);
    }
  }

  public getRoomsList(): readonly RoomInfo[] {
    return Array.from(this.rooms.entries()).map(([roomId, gameManager]) => ({
      id: roomId,
      name: this.roomNames.get(roomId) ?? 'Unknown Room',
      playerCount: gameManager.getPlayerCount(),
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      isStarted: gameManager.isGameStarted(),
      isGameOver: gameManager.isGameOver(),
    }));
  }

  public broadcastRoomsList(): void {
    this.io.emit('rooms_list', { rooms: this.getRoomsList() });
  }

  public findRoomByCode(roomCode: string): string | null {
    if (roomCode.toLowerCase() === 'default' || roomCode === '') {
      return DEFAULT_ROOM_ID;
    }

    for (const [roomId, roomName] of this.roomNames.entries()) {
      if (roomName === roomCode) {
        return roomId;
      }
    }

    return null;
  }

  public joinRoomByCode(socket: Socket, playerName: string, roomCode: string): void {
    const roomId = this.findRoomByCode(roomCode);

    if (!roomId) {
      socket.emit('join_failed', { reason: `Room "${roomCode}" not found` });
      return;
    }

    this.joinRoom(socket, playerName, roomId);
  }
}
