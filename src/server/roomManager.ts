import type { Server as SocketIOServer, Socket } from 'socket.io';
import { GameManager } from './gameManager.js';
import type { RoomInfo } from './types.js';

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

  private createDefaultRoom(): void {
    const defaultRoomId = 'room_default';
    const gameManager = new GameManager(this.io, defaultRoomId);
    this.rooms.set(defaultRoomId, gameManager);
    this.roomNames.set(defaultRoomId, 'Default Room');
    console.log('📦 Default room created:', defaultRoomId);
  }

  public createRoom(socket: Socket, playerName: string, roomName: string): void {
    this.roomCounter++;
    const roomId = `room_${this.roomCounter}`;

    const gameManager = new GameManager(this.io, roomId);
    this.rooms.set(roomId, gameManager);
    this.roomNames.set(roomId, roomName); // Store custom room name

    console.log(`📦 Room created: ${roomId} (${roomName}) by ${playerName}`);

    // Join the creator to the room
    this.joinRoom(socket, playerName, roomId);

    socket.emit('room_created', {
      roomId,
      roomName,
    });
  }

  public joinRoom(socket: Socket, playerName: string, roomId?: string): void {
    const targetRoomId = roomId || 'room_default';
    const gameManager = this.rooms.get(targetRoomId);

    if (!gameManager) {
      socket.emit('join_failed', { reason: 'Room not found' });
      return;
    }

    // Remove player from previous room if exists
    const previousRoom = this.playerRooms.get(socket.id);
    if (previousRoom) {
      this.leaveRoom(socket.id);
    }

    // Join new room
    this.playerRooms.set(socket.id, targetRoomId);
    socket.join(targetRoomId);

    gameManager.handlePlayerJoin(socket, playerName);
  }

  public leaveRoom(socketId: string): void {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) return;

    const gameManager = this.rooms.get(roomId);
    if (gameManager) {
      gameManager.handleLeaveGame(socketId);
    }

    this.playerRooms.delete(socketId);

    // Clean up empty non-default rooms
    if (roomId !== 'room_default' && gameManager && gameManager.getPlayerCount() === 0) {
      this.rooms.delete(roomId);
      this.roomNames.delete(roomId); // Also clean up room name
      console.log(`📦 Empty room deleted: ${roomId}`);
    }
  }

  public handlePlayerMove(socketId: string, direction: any): void {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) return;

    const gameManager = this.rooms.get(roomId);
    if (gameManager) {
      gameManager.handlePlayerMove(socketId, direction);
    }
  }

  public handleStartGame(socketId: string): void {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) return;

    const gameManager = this.rooms.get(roomId);
    if (gameManager) {
      gameManager.handleStartGame(socketId);
    }
  }

  public handleRestartGame(socketId: string): void {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) return;

    const gameManager = this.rooms.get(roomId);
    if (gameManager) {
      gameManager.handleRestartGame(socketId);
    }
  }

  public handlePlayerDisconnect(socketId: string): void {
    const roomId = this.playerRooms.get(socketId);
    if (!roomId) return;

    const gameManager = this.rooms.get(roomId);
    if (gameManager) {
      gameManager.handlePlayerDisconnect(socketId);
    }

    this.playerRooms.delete(socketId);
  }

  public getRoomsList(): readonly RoomInfo[] {
    return Array.from(this.rooms.entries()).map(([roomId, gameManager]) => ({
      id: roomId,
      name: this.roomNames.get(roomId) || 'Unknown Room',
      playerCount: gameManager.getPlayerCount(),
      maxPlayers: 5,
      isStarted: gameManager.isGameStarted(),
      isGameOver: gameManager.isGameOver(),
    }));
  }

  public broadcastRoomsList(): void {
    const roomsList = this.getRoomsList();
    this.io.emit('rooms_list', { rooms: roomsList });
  }

  public findRoomByCode(roomCode: string): string | null {
    // First check if it's the default room
    if (roomCode.toLowerCase() === 'default' || roomCode === '') {
      return 'room_default';
    }

    // Look for a room with this custom name
    for (const [roomId, roomName] of this.roomNames.entries()) {
      if (roomName === roomCode) {
        return roomId;
      }
    }

    return null; // Room not found
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
