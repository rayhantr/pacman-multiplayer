import { io, type Socket } from 'socket.io-client';
import type {
  ClientGameState,
  ClientToServerEvents,
  Direction,
  PowerUpType,
  RoomInfo,
  ServerToClientEvents,
} from '../shared/types';

/** Client-local player record: the wire shape plus interpolation fields. */
interface RenderPlayer {
  id: string;
  name: string;
  role: 'pacman' | 'ghost';
  ghostColor?: string | null | undefined;
  x: number;
  y: number;
  direction: string;
  // Smooth-movement interpolation state
  renderX?: number;
  renderY?: number;
  targetX?: number;
  targetY?: number;
  lastMoveTime?: number;
}

interface SpawnedPowerUp {
  type: PowerUpType;
  spawnTime: number;
}

interface LocalGameState {
  players: Record<string, RenderPlayer>;
  maze: readonly (readonly number[])[];
  pellets: Set<string>;
  powerUps: Record<string, SpawnedPowerUp>;
  score: number;
  pelletsRemaining: number;
  gameStarted: boolean;
  gameOver: boolean;
  playerId: string | null;
  playerRole: string | null;
  selectedRoom: string | null;
  rooms: RoomInfo[];
}

class PacManGame {
  private socket!: Socket<ServerToClientEvents, ClientToServerEvents>;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private gameState!: LocalGameState;
  private readonly CELL_SIZE = 30;
  private readonly MAZE_WIDTH = 20;
  private readonly MAZE_HEIGHT = 19;

  private readonly COLORS = {
    wall: '#0000ff',
    path: '#000000',
    pellet: '#ffff00',
    pacman: '#ffff00',
    ghost: {
      red: '#ff0000',
      pink: '#ffb8ff',
      cyan: '#00ffff',
      orange: '#ffb852',
    },
    powerUp: {
      speed_boost: '#00ff00',
      invincibility: '#ff00ff',
      pellet_multiplier: '#00ffff',
    },
  };

  constructor() {
    this.initializeCanvas();
    this.initializeGameState();
    this.connectToServer();
    this.setupEventListeners();
    this.startGameLoop();
  }

  private initializeCanvas(): void {
    this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    if (!this.canvas) {
      console.error('Canvas element not found');
      return;
    }

    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.width = this.MAZE_WIDTH * this.CELL_SIZE;
    this.canvas.height = this.MAZE_HEIGHT * this.CELL_SIZE;
  }

  private initializeGameState(): void {
    this.gameState = {
      players: {},
      maze: [],
      pellets: new Set(),
      powerUps: {},
      score: 0,
      pelletsRemaining: 0,
      gameStarted: false,
      gameOver: false,
      playerId: null,
      playerRole: null,
      selectedRoom: null,
      rooms: [],
    };
  }

  private connectToServer(): void {
    // Same-origin connection: in dev the Vite server proxies /socket.io to the
    // Express server; in production the Express server handles it directly.
    this.socket = io({
      transports: ['websocket', 'polling'],
      timeout: 10000,
      forceNew: true,
    });

    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.updateConnectionStatus(true);
      this.requestRoomsList();

      // Re-enable join button on reconnection
      const joinButton = document.getElementById('joinButton') as HTMLButtonElement | null;
      if (joinButton?.textContent === 'JOINING...') {
        joinButton.disabled = false;
        joinButton.textContent = 'JOIN';
      }
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.updateConnectionStatus(false);
    });

    this.setupSocketEvents();
  }

  private setupSocketEvents(): void {
    this.socket.on('join_success', data => {
      this.gameState.playerId = data.player_id;
      this.gameState.playerRole = data.role;
      this.updateGameState(data.game_state);
      this.showWaitingRoom();
    });

    this.socket.on('join_failed', data => {
      alert('Failed to join game: ' + data.reason);
      const joinButton = document.getElementById('joinButton') as HTMLButtonElement | null;
      if (joinButton) {
        joinButton.disabled = false;
        joinButton.textContent = 'JOIN';
      }
    });

    this.socket.on('player_joined', data => {
      this.gameState.players[data.player.id] = { ...data.player };
      this.updatePlayersDisplay();
      this.updateStartButton(data.can_start);
    });

    this.socket.on('player_left', data => {
      delete this.gameState.players[data.player_id];
      this.updatePlayersDisplay();
    });

    this.socket.on('game_started', () => {
      this.gameState.gameStarted = true;
      this.showGameCanvas();
      this.playBackgroundMusic();
    });

    this.socket.on('player_moved', data => {
      const player = this.gameState.players[data.player_id];
      if (player) {
        // Set up smooth movement interpolation
        player.renderX = player.renderX ?? player.x;
        player.renderY = player.renderY ?? player.y;
        player.targetX = data.x;
        player.targetY = data.y;
        player.lastMoveTime = Date.now();

        // Update actual position for game logic
        player.x = data.x;
        player.y = data.y;
        player.direction = data.direction;
      }

      this.gameState.score = data.score;
      this.gameState.pelletsRemaining = data.pellets_remaining;
      this.updateGameInfo();
    });

    this.socket.on('pellet_collected', data => {
      this.gameState.pellets.delete(data.position);
      this.gameState.score = data.score;
      this.gameState.pelletsRemaining = data.pellets_remaining;
      this.updateGameInfo();
      this.playPelletSound();
    });

    this.socket.on('power_up_spawned', data => {
      this.gameState.powerUps[data.position] = {
        type: data.type,
        spawnTime: Date.now(),
      };
    });

    this.socket.on('power_up_collected', data => {
      delete this.gameState.powerUps[data.position];
      this.playPowerUpSound();
    });

    this.socket.on('power_up_expired', () => {
      // Effect timed out server-side; no board state to update on the client.
    });

    this.socket.on('game_over', data => {
      this.gameState.gameOver = true;
      this.showGameOverScreen(data.winner, data.score);
      this.stopBackgroundMusic();
    });

    this.socket.on('game_restarted', data => {
      this.gameState.gameStarted = false;
      this.gameState.gameOver = false;
      this.updateGameState(data.game_state);
      this.showWaitingRoom();
    });

    this.socket.on('rooms_list', data => {
      this.gameState.rooms = [...data.rooms];
      this.updateRoomsList();
    });

    this.socket.on('room_created', data => {
      this.gameState.selectedRoom = data.roomId;
      alert(
        `Room created successfully!\n\nRoom Code: ${data.roomName}\n\n` +
          'Share this code with friends so they can join your room.'
      );
      // Room creation automatically joins the room; join_success follows.
    });
  }

  private setupEventListeners(): void {
    document.addEventListener('keydown', event => {
      if (!this.gameState.gameStarted || this.gameState.gameOver) {
        return;
      }

      let direction: Direction | null = null;
      switch (event.key) {
        case 'ArrowUp':
          direction = 'up';
          break;
        case 'ArrowDown':
          direction = 'down';
          break;
        case 'ArrowLeft':
          direction = 'left';
          break;
        case 'ArrowRight':
          direction = 'right';
          break;
      }

      if (direction) {
        event.preventDefault();
        this.socket.emit('player_move', { direction });
      }
    });

    this.bindClick('joinRoomButton', () => this.joinRoomByCode());
    this.bindClick('quickJoinButton', () => this.quickJoin());
    this.bindClick('createRoomButton', () => this.showCreateRoomForm());
    this.bindClick('createRoomConfirmButton', () => this.createRoom());
    this.bindClick('backToRoomsButton', () => this.showRoomSelection());
    this.bindClick('joinButton', () => this.joinGame());
    this.bindClick('backToRoomsFromJoinButton', () => this.showRoomSelection());
    this.bindClick('startButton', () => this.startGame());

    const roomCodeInput = document.getElementById('roomCodeInput') as HTMLInputElement | null;
    roomCodeInput?.addEventListener('keypress', event => {
      if (event.key === 'Enter') {
        this.joinRoomByCode();
      }
    });

    const nameInputs = ['playerName', 'newRoomName', 'hostPlayerName'];
    nameInputs.forEach(inputId => {
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      input?.addEventListener('keypress', event => {
        if (event.key !== 'Enter') {
          return;
        }
        if (inputId === 'playerName') {
          this.joinGame();
        } else {
          this.createRoom();
        }
      });
    });
  }

  private bindClick(elementId: string, handler: () => void): void {
    const el = document.getElementById(elementId);
    el?.addEventListener('click', handler);
  }

  private startGameLoop(): void {
    const gameLoop = (): void => {
      this.render();
      requestAnimationFrame(gameLoop);
    };
    gameLoop();
  }

  private render(): void {
    if (!this.gameState.gameStarted) {
      return;
    }

    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.updatePlayerInterpolation();
    this.drawMaze();
    this.drawPellets();
    this.drawPowerUps();
    this.drawPlayers();
  }

  private updatePlayerInterpolation(): void {
    const currentTime = Date.now();
    const MOVEMENT_DURATION = 200; // ms

    Object.values(this.gameState.players).forEach(player => {
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

  private drawMaze(): void {
    if (!this.gameState.maze.length) {
      return;
    }

    this.ctx.fillStyle = this.COLORS.wall;
    for (let y = 0; y < this.gameState.maze.length; y++) {
      const row = this.gameState.maze[y]!;
      for (let x = 0; x < row.length; x++) {
        if (row[x] === 1) {
          this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
        }
      }
    }
  }

  private drawPellets(): void {
    this.ctx.fillStyle = this.COLORS.pellet;
    this.gameState.pellets.forEach(pelletPos => {
      const [x, y] = pelletPos.split(',').map(Number);
      const centerX = x! * this.CELL_SIZE + this.CELL_SIZE / 2;
      const centerY = y! * this.CELL_SIZE + this.CELL_SIZE / 2;

      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }

  private drawPowerUps(): void {
    Object.entries(this.gameState.powerUps).forEach(([position, powerUp]) => {
      const [x, y] = position.split(',').map(Number);
      const centerX = x! * this.CELL_SIZE + this.CELL_SIZE / 2;
      const centerY = y! * this.CELL_SIZE + this.CELL_SIZE / 2;

      this.ctx.fillStyle = this.COLORS.powerUp[powerUp.type];
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }

  private drawPlayers(): void {
    Object.values(this.gameState.players).forEach(player => {
      const renderX = player.renderX ?? player.x;
      const renderY = player.renderY ?? player.y;

      const centerX = renderX * this.CELL_SIZE + this.CELL_SIZE / 2;
      const centerY = renderY * this.CELL_SIZE + this.CELL_SIZE / 2;

      if (player.role === 'pacman') {
        this.ctx.fillStyle = this.COLORS.pacman;
      } else {
        const ghostColor = player.ghostColor as keyof typeof this.COLORS.ghost;
        this.ctx.fillStyle = this.COLORS.ghost[ghostColor] || this.COLORS.ghost.red;
      }

      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, this.CELL_SIZE / 2 - 2, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }

  public joinGame(roomCode?: string): void {
    const nameInput = document.getElementById('playerName') as HTMLInputElement | null;
    const joinButton = document.getElementById('joinButton') as HTMLButtonElement | null;
    const playerName = nameInput?.value.trim();

    if (!playerName) {
      alert('Please enter your name');
      return;
    }

    if (!this.socket.connected) {
      alert('Not connected to server. Please wait for connection or refresh the page.');
      return;
    }

    if (joinButton) {
      joinButton.disabled = true;
      joinButton.textContent = 'JOINING...';
    }

    const finalRoomCode = roomCode ?? this.gameState.selectedRoom ?? 'default';
    this.socket.emit('join_game', { name: playerName, roomCode: finalRoomCode });
  }

  public startGame(): void {
    this.socket.emit('start_game');
  }

  private updateGameState(gameState: ClientGameState): void {
    this.gameState.players = {};
    gameState.players.forEach(player => {
      this.gameState.players[player.id] = { ...player };
    });

    this.gameState.maze = gameState.maze;
    this.gameState.pellets = new Set(gameState.pellets);
    this.gameState.powerUps = {};
    for (const [position, powerUp] of Object.entries(gameState.powerUps)) {
      this.gameState.powerUps[position] = { type: powerUp.type, spawnTime: powerUp.spawnTime };
    }
    this.gameState.score = gameState.score;
    this.gameState.pelletsRemaining = gameState.pelletsRemaining;
  }

  private showWaitingRoom(): void {
    this.hideAllScreens();
    const waitingRoom = document.getElementById('waitingRoom');
    if (waitingRoom) {
      waitingRoom.style.display = 'block';
    }
    this.updatePlayersDisplay();
  }

  private showGameCanvas(): void {
    this.hideAllScreens();
    const gameContainer = document.getElementById('gameContainer');
    if (gameContainer) {
      gameContainer.style.display = 'block';
    }
    this.updateGameInfo();
  }

  private updatePlayersDisplay(): void {
    const playersList = document.getElementById('playersList');
    if (!playersList) {
      return;
    }

    playersList.textContent = '';
    Object.values(this.gameState.players).forEach(player => {
      const playerDiv = document.createElement('div');
      playerDiv.className = `player-item player-${player.role}`;
      playerDiv.textContent = `${player.name} (${player.role.toUpperCase()})`;
      playersList.appendChild(playerDiv);
    });

    this.setText('playersCount', Object.keys(this.gameState.players).length.toString());
  }

  private updateStartButton(canStart: boolean): void {
    const startButton = document.getElementById('startButton') as HTMLButtonElement | null;
    if (!startButton) {
      return;
    }

    if (this.gameState.playerRole === 'pacman') {
      startButton.style.display = 'block';
      startButton.disabled = !canStart;
    } else {
      startButton.disabled = true;
    }
  }

  private updateGameInfo(): void {
    const score = this.gameState.score.toString();
    const pellets = this.gameState.pelletsRemaining.toString();
    const players = Object.keys(this.gameState.players).length.toString();

    this.setText('score', score);
    this.setText('pellets', pellets);
    this.setText('playersCount', players);
    this.setText('gameScore', score);
    this.setText('gamePellets', pellets);
    this.setText('gamePlayers', players);
  }

  private setText(elementId: string, text: string): void {
    const el = document.getElementById(elementId);
    if (el) {
      el.textContent = text;
    }
  }

  private updateConnectionStatus(connected: boolean): void {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
      statusElement.textContent = connected ? 'Connected' : 'Disconnected';
      statusElement.className = connected ? 'connected' : 'disconnected';
    }
  }

  private showGameOverScreen(winner: string, score: number): void {
    const gameContainer = document.getElementById('gameContainer');
    if (gameContainer) {
      gameContainer.style.display = 'none';
    }

    const isWinner = winner === this.gameState.playerRole;

    const overlay = document.createElement('div');
    overlay.id = 'gameOverScreen';
    overlay.className = 'game-over-screen';

    const panel = document.createElement('div');
    panel.className = 'game-over-panel';

    const heading = document.createElement('h1');
    heading.className = isWinner ? 'game-over-win' : 'game-over-lose';
    heading.textContent = isWinner ? 'You Win!' : 'Game Over!';

    const winnerLine = document.createElement('p');
    winnerLine.textContent = `Winner: ${winner.toUpperCase()}`;

    const scoreLine = document.createElement('p');
    scoreLine.textContent = `Final Score: ${score}`;

    const actions = document.createElement('div');
    actions.className = 'game-over-actions';

    const restartButton = document.createElement('button');
    restartButton.className = 'btn btn-success';
    restartButton.textContent = 'Play Again';
    restartButton.addEventListener('click', () => this.restartGame());

    const lobbyButton = document.createElement('button');
    lobbyButton.className = 'btn btn-primary';
    lobbyButton.textContent = 'Back to Lobby';
    lobbyButton.addEventListener('click', () => this.backToLobby());

    actions.append(restartButton, lobbyButton);
    panel.append(heading, winnerLine, scoreLine, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  private restartGame(): void {
    this.gameState.gameStarted = false;
    this.gameState.gameOver = false;
    this.gameState.score = 0;
    this.gameState.pelletsRemaining = 0;

    document.getElementById('gameOverScreen')?.remove();
    this.showWaitingRoom();

    if (this.gameState.playerRole === 'pacman') {
      this.socket.emit('restart_game');
    }
  }

  private backToLobby(): void {
    this.gameState.gameStarted = false;
    this.gameState.gameOver = false;
    this.gameState.playerId = null;
    this.gameState.playerRole = null;
    this.gameState.players = {};

    document.getElementById('gameOverScreen')?.remove();
    this.socket.emit('leave_game');
    this.showRoomSelection();
    this.requestRoomsList();

    const nameInput = document.getElementById('playerName') as HTMLInputElement | null;
    if (nameInput) {
      nameInput.value = '';
    }
  }

  private playBackgroundMusic(): void {
    const bgMusic = document.getElementById('backgroundMusic') as HTMLAudioElement | null;
    if (bgMusic) {
      bgMusic.volume = 0.3;
      bgMusic.play().catch(e => console.log('Audio play failed:', e));
    }
  }

  private stopBackgroundMusic(): void {
    const bgMusic = document.getElementById('backgroundMusic') as HTMLAudioElement | null;
    bgMusic?.pause();
  }

  private playPowerUpSound(): void {
    const powerUpSound = document.getElementById('powerUpSound') as HTMLAudioElement | null;
    if (powerUpSound) {
      powerUpSound.volume = 0.7;
      powerUpSound.play().catch(e => console.log('Audio play failed:', e));
    }
  }

  private playPelletSound(): void {
    const pelletSound = document.getElementById('pelletSound') as HTMLAudioElement | null;
    if (pelletSound) {
      pelletSound.volume = 0.5;
      pelletSound.play().catch(e => console.log('Audio play failed:', e));
    }
  }

  private requestRoomsList(): void {
    if (this.socket.connected) {
      this.socket.emit('list_rooms');
    }
  }

  private updateRoomsList(): void {
    const roomsList = document.getElementById('roomsList');
    if (!roomsList) {
      return;
    }

    roomsList.textContent = '';

    if (this.gameState.rooms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'loading';
      empty.textContent = 'No rooms available';
      roomsList.appendChild(empty);
      return;
    }

    this.gameState.rooms.forEach(room => {
      const item = document.createElement('div');
      item.className = 'room-item';
      item.setAttribute('role', 'listitem');

      const info = document.createElement('div');
      info.className = 'room-item-info';

      const name = document.createElement('div');
      name.className = 'room-name';
      name.textContent = room.name; // textContent = no HTML injection

      const details = document.createElement('div');
      details.className = 'room-details';
      details.textContent = `Players: ${room.playerCount}/${room.maxPlayers}`;

      info.append(name, details);

      const status = document.createElement('div');
      status.className = `room-status ${this.getRoomStatusClass(room)}`;
      status.textContent = this.getRoomStatusText(room);

      const joinBtn = document.createElement('button');
      joinBtn.className = 'btn btn-primary room-join-btn';
      joinBtn.textContent = 'JOIN';
      joinBtn.disabled = room.playerCount >= room.maxPlayers || room.isStarted;
      joinBtn.addEventListener('click', () => this.joinSpecificRoom(room.name));

      item.append(info, status, joinBtn);
      roomsList.appendChild(item);
    });
  }

  private getRoomStatusClass(room: RoomInfo): string {
    if (room.playerCount >= room.maxPlayers) {
      return 'full';
    }
    if (room.isStarted) {
      return 'playing';
    }
    return 'waiting';
  }

  private getRoomStatusText(room: RoomInfo): string {
    if (room.playerCount >= room.maxPlayers) {
      return 'FULL';
    }
    if (room.isStarted) {
      return 'PLAYING';
    }
    return 'WAITING';
  }

  private quickJoin(): void {
    this.gameState.selectedRoom = 'default';
    this.showJoinForm();
  }

  private joinRoomByCode(): void {
    const roomCodeInput = document.getElementById('roomCodeInput') as HTMLInputElement | null;
    const roomCode = roomCodeInput?.value.trim();

    if (!roomCode) {
      alert('Please enter a room code');
      return;
    }

    this.gameState.selectedRoom = roomCode;
    this.showJoinForm();
  }

  private showCreateRoomForm(): void {
    this.hideAllScreens();
    const createRoomForm = document.getElementById('createRoomForm');
    if (createRoomForm) {
      createRoomForm.style.display = 'block';
    }
  }

  private showRoomSelection(): void {
    this.hideAllScreens();
    const roomSelection = document.getElementById('roomSelection');
    if (roomSelection) {
      roomSelection.style.display = 'block';
    }
  }

  private showJoinForm(): void {
    this.hideAllScreens();
    const joinForm = document.getElementById('joinForm');
    if (joinForm) {
      joinForm.style.display = 'block';
    }
  }

  private hideAllScreens(): void {
    const screens = ['roomSelection', 'createRoomForm', 'joinForm', 'waitingRoom', 'gameContainer'];
    screens.forEach(screenId => {
      const screen = document.getElementById(screenId);
      if (screen) {
        screen.style.display = 'none';
      }
    });
  }

  private createRoom(): void {
    const roomNameInput = document.getElementById('newRoomName') as HTMLInputElement | null;
    const hostNameInput = document.getElementById('hostPlayerName') as HTMLInputElement | null;

    const roomName = roomNameInput?.value.trim();
    const hostName = hostNameInput?.value.trim();

    if (!roomName) {
      alert('Please enter a room name');
      return;
    }

    if (!hostName) {
      alert('Please enter your name');
      return;
    }

    if (!this.socket.connected) {
      alert('Not connected to server. Please wait for connection or refresh the page.');
      return;
    }

    this.socket.emit('create_room', { name: hostName, roomName });
  }

  public joinSpecificRoom(roomCode: string): void {
    this.gameState.selectedRoom = roomCode;
    this.showJoinForm();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PacManGame();
});
