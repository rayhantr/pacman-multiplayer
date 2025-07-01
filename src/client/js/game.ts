// Global Socket.io declaration (loaded via CDN)
declare const io: any;

// TypeScript interfaces for client-side game
interface ClientPlayer {
  id: string;
  name: string;
  role: 'pacman' | 'ghost';
  ghostColor?: string | null;
  x: number;
  y: number;
  direction: string;
  // Smooth movement properties
  renderX?: number;
  renderY?: number;
  targetX?: number;
  targetY?: number;
  lastMoveTime?: number;
}

interface RoomInfo {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  isStarted: boolean;
  isGameOver: boolean;
}

interface GameState {
  players: { [id: string]: ClientPlayer };
  maze: number[][];
  pellets: Set<string>;
  powerUps: { [key: string]: any };
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
  private socket: any;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private gameState!: GameState;
  private readonly CELL_SIZE = 30;
  private readonly MAZE_WIDTH = 20;
  private readonly MAZE_HEIGHT = 19;
  private animationFrame: number | null = null;

  // Colors
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
    this.setupSocketEvents();
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
    this.socket = io({
      transports: ['websocket', 'polling'],
      timeout: 10000,
      forceNew: true,
    });

    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.updateConnectionStatus(true);
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.updateConnectionStatus(false);
    });

    this.setupSocketEvents();
  }

  private setupSocketEvents(): void {
    // Re-enable join button on reconnection
    this.socket.on('connect', () => {
      const joinButton = document.getElementById('joinButton') as HTMLButtonElement;
      if (joinButton && joinButton.textContent === 'JOINING...') {
        joinButton.disabled = false;
        joinButton.textContent = 'JOIN';
      }
    });

    this.socket.on('join_success', (data: any) => {
      console.log('Received join_success:', data);
      this.gameState.playerId = data.player_id;
      this.gameState.playerRole = data.role;
      console.log('About to update game state with:', data.game_state);
      this.updateGameState(data.game_state);
      console.log('Calling showWaitingRoom()');
      this.showWaitingRoom();
    });

    this.socket.on('join_failed', (data: any) => {
      alert('Failed to join game: ' + data.reason);

      // Re-enable join button
      const joinButton = document.getElementById('joinButton') as HTMLButtonElement;
      if (joinButton) {
        joinButton.disabled = false;
        joinButton.textContent = 'JOIN';
      }
    });

    this.socket.on('player_joined', (data: any) => {
      this.gameState.players[data.player.id] = data.player;
      this.updatePlayersDisplay();
      this.updateStartButton(data.can_start);
    });

    this.socket.on('player_left', (data: any) => {
      delete this.gameState.players[data.player_id];
      this.updatePlayersDisplay();
    });

    this.socket.on('game_started', () => {
      this.gameState.gameStarted = true;
      this.showGameCanvas();
      this.playBackgroundMusic();
    });

    this.socket.on('player_moved', (data: any) => {
      if (this.gameState.players[data.player_id]) {
        const player = this.gameState.players[data.player_id];

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

    this.socket.on('pellet_collected', (data: any) => {
      // Remove pellet from client state
      this.gameState.pellets.delete(data.position);
      this.gameState.score = data.score;
      this.gameState.pelletsRemaining = data.pellets_remaining;
      this.updateGameInfo();
      this.playPelletSound();
    });

    this.socket.on('power_up_spawned', (data: any) => {
      this.gameState.powerUps[data.position] = {
        type: data.type,
        spawnTime: Date.now(),
      };
    });

    this.socket.on('power_up_collected', (data: any) => {
      delete this.gameState.powerUps[data.position];
      this.playPowerUpSound();
    });

    this.socket.on('game_over', (data: any) => {
      this.gameState.gameOver = true;
      this.showGameOverScreen(data.winner, data.score);
      this.stopBackgroundMusic();
    });

    this.socket.on('game_restarted', (data: any) => {
      this.gameState.gameStarted = false;
      this.gameState.gameOver = false;
      this.updateGameState(data.game_state);
      this.showWaitingRoom();
    });

    // Room-related events
    this.socket.on('rooms_list', (data: any) => {
      this.gameState.rooms = data.rooms;
      this.updateRoomsList();
    });

    this.socket.on('room_created', (data: any) => {
      this.gameState.selectedRoom = data.roomId;
      // Show the room code to the user
      alert(
        `Room created successfully!\n\nRoom Code: ${data.roomName}\n\nShare this code with friends so they can join your room.`
      );
      // Room creation automatically joins the room, so we should be getting join_success next
    });
  }

  private setupEventListeners(): void {
    // Keyboard controls
    document.addEventListener('keydown', event => {
      if (!this.gameState.gameStarted || this.gameState.gameOver) return;

      let direction: string | null = null;
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

    // Room selection buttons
    const joinRoomButton = document.getElementById('joinRoomButton');
    if (joinRoomButton) {
      joinRoomButton.addEventListener('click', () => this.joinRoomByCode());
    }

    const quickJoinButton = document.getElementById('quickJoinButton');
    if (quickJoinButton) {
      quickJoinButton.addEventListener('click', () => this.quickJoin());
    }

    const createRoomButton = document.getElementById('createRoomButton');
    if (createRoomButton) {
      createRoomButton.addEventListener('click', () => this.showCreateRoomForm());
    }

    // Create room form buttons
    const createRoomConfirmButton = document.getElementById('createRoomConfirmButton');
    if (createRoomConfirmButton) {
      createRoomConfirmButton.addEventListener('click', () => this.createRoom());
    }

    const backToRoomsButton = document.getElementById('backToRoomsButton');
    if (backToRoomsButton) {
      backToRoomsButton.addEventListener('click', () => this.showRoomSelection());
    }

    // Join game button
    const joinButton = document.getElementById('joinButton');
    if (joinButton) {
      joinButton.addEventListener('click', () => this.joinGame());
    }

    const backToRoomsFromJoinButton = document.getElementById('backToRoomsFromJoinButton');
    if (backToRoomsFromJoinButton) {
      backToRoomsFromJoinButton.addEventListener('click', () => this.showRoomSelection());
    }

    // Start game button
    const startButton = document.getElementById('startButton');
    if (startButton) {
      startButton.addEventListener('click', () => this.startGame());
    }

    // Enter key handlers
    const roomCodeInput = document.getElementById('roomCodeInput') as HTMLInputElement;
    if (roomCodeInput) {
      roomCodeInput.addEventListener('keypress', event => {
        if (event.key === 'Enter') {
          this.joinRoomByCode();
        }
      });
    }

    const nameInputs = ['playerName', 'newRoomName', 'hostPlayerName'];
    nameInputs.forEach(inputId => {
      const input = document.getElementById(inputId) as HTMLInputElement;
      if (input) {
        input.addEventListener('keypress', event => {
          if (event.key === 'Enter') {
            if (inputId === 'playerName') {
              this.joinGame();
            } else if (inputId === 'newRoomName' || inputId === 'hostPlayerName') {
              this.createRoom();
            }
          }
        });
      }
    });
  }

  private startGameLoop(): void {
    const gameLoop = () => {
      this.render();
      this.animationFrame = requestAnimationFrame(gameLoop);
    };
    gameLoop();
  }

  private render(): void {
    if (!this.gameState.gameStarted) return;

    // Clear canvas
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Update player interpolation
    this.updatePlayerInterpolation();

    // Draw maze
    this.drawMaze();

    // Draw pellets
    this.drawPellets();

    // Draw power-ups
    this.drawPowerUps();

    // Draw players
    this.drawPlayers();
  }

  private updatePlayerInterpolation(): void {
    const currentTime = Date.now();
    const MOVEMENT_DURATION = 200; // milliseconds for smooth movement

    Object.values(this.gameState.players).forEach(player => {
      if (player.lastMoveTime && player.targetX !== undefined && player.targetY !== undefined) {
        const elapsed = currentTime - player.lastMoveTime;
        const progress = Math.min(elapsed / MOVEMENT_DURATION, 1);

        // Use easing function for smoother animation
        const easedProgress = this.easeOutCubic(progress);

        const startX = player.renderX ?? player.targetX;
        const startY = player.renderY ?? player.targetY;

        player.renderX = startX + (player.targetX - startX) * easedProgress;
        player.renderY = startY + (player.targetY - startY) * easedProgress;

        // If animation is complete, snap to target
        if (progress >= 1) {
          player.renderX = player.targetX;
          player.renderY = player.targetY;
          delete player.lastMoveTime;
        }
      } else {
        // Initialize render position if not set
        player.renderX = player.renderX ?? player.x;
        player.renderY = player.renderY ?? player.y;
      }
    });
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private drawMaze(): void {
    if (!this.gameState.maze.length) return;

    this.ctx.fillStyle = this.COLORS.wall;
    for (let y = 0; y < this.gameState.maze.length; y++) {
      for (let x = 0; x < this.gameState.maze[y].length; x++) {
        if (this.gameState.maze[y][x] === 1) {
          this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
        }
      }
    }
  }

  private drawPellets(): void {
    this.ctx.fillStyle = this.COLORS.pellet;
    this.gameState.pellets.forEach(pelletPos => {
      const [x, y] = pelletPos.split(',').map(Number);
      const centerX = x * this.CELL_SIZE + this.CELL_SIZE / 2;
      const centerY = y * this.CELL_SIZE + this.CELL_SIZE / 2;

      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }

  private drawPowerUps(): void {
    Object.entries(this.gameState.powerUps).forEach(([position, powerUp]) => {
      const [x, y] = position.split(',').map(Number);
      const centerX = x * this.CELL_SIZE + this.CELL_SIZE / 2;
      const centerY = y * this.CELL_SIZE + this.CELL_SIZE / 2;

      this.ctx.fillStyle = this.COLORS.powerUp[powerUp.type as keyof typeof this.COLORS.powerUp];
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }

  private drawPlayers(): void {
    Object.values(this.gameState.players).forEach(player => {
      // Use interpolated positions for smooth movement
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
    const nameInput = document.getElementById('playerName') as HTMLInputElement;
    const joinButton = document.getElementById('joinButton') as HTMLButtonElement;
    const playerName = nameInput?.value.trim();

    if (!playerName) {
      alert('Please enter your name');
      return;
    }

    if (!this.socket.connected) {
      alert('Not connected to server. Please wait for connection or refresh the page.');
      return;
    }

    // Prevent multiple join attempts
    if (joinButton) {
      joinButton.disabled = true;
      joinButton.textContent = 'JOINING...';
    }

    // Send room code in join request
    const finalRoomCode = roomCode || this.gameState.selectedRoom || 'default';
    const joinData: any = {
      name: playerName,
      roomCode: finalRoomCode,
    };

    this.socket.emit('join_game', joinData);
  }

  public startGame(): void {
    this.socket.emit('start_game');
  }

  private updateGameState(gameState: any): void {
    this.gameState.players = {};
    gameState.players.forEach((player: ClientPlayer) => {
      this.gameState.players[player.id] = player;
    });

    this.gameState.maze = gameState.maze;
    this.gameState.pellets = new Set(gameState.pellets);
    this.gameState.powerUps = gameState.powerUps;
    this.gameState.score = gameState.score;
    this.gameState.pelletsRemaining = gameState.pelletsRemaining;
  }

  private showWaitingRoom(): void {
    const joinForm = document.getElementById('joinForm');
    const waitingRoom = document.getElementById('waitingRoom');

    if (joinForm) joinForm.style.display = 'none';
    if (waitingRoom) waitingRoom.style.display = 'block';

    this.updatePlayersDisplay();
  }

  private showGameCanvas(): void {
    const waitingRoom = document.getElementById('waitingRoom');
    const gameContainer = document.getElementById('gameContainer');

    if (waitingRoom) waitingRoom.style.display = 'none';
    if (gameContainer) gameContainer.style.display = 'block';

    this.updateGameInfo();
  }

  private updatePlayersDisplay(): void {
    const playersList = document.getElementById('playersList');
    if (!playersList) return;

    playersList.innerHTML = '';
    Object.values(this.gameState.players).forEach(player => {
      const playerDiv = document.createElement('div');
      playerDiv.className = `player-item player-${player.role}`;
      playerDiv.textContent = `${player.name} (${player.role.toUpperCase()})`;
      playersList.appendChild(playerDiv);
    });

    const playersCountElement = document.getElementById('playersCount');
    if (playersCountElement) {
      playersCountElement.textContent = Object.keys(this.gameState.players).length.toString();
    }
  }

  private updateStartButton(canStart: boolean): void {
    const startButton = document.getElementById('startButton') as HTMLButtonElement;
    if (!startButton) return;

    if (this.gameState.playerRole === 'pacman' && canStart) {
      startButton.style.display = 'block';
      startButton.disabled = false;
    } else {
      startButton.disabled = true;
      if (this.gameState.playerRole === 'pacman') {
        startButton.style.display = 'block';
      }
    }
  }

  private updateGameInfo(): void {
    const scoreElement = document.getElementById('score');
    const pelletsElement = document.getElementById('pellets');
    const playersElement = document.getElementById('players');

    if (scoreElement) scoreElement.textContent = this.gameState.score.toString();
    if (pelletsElement) pelletsElement.textContent = this.gameState.pelletsRemaining.toString();
    if (playersElement)
      playersElement.textContent = Object.keys(this.gameState.players).length.toString();
  }

  private updateConnectionStatus(connected: boolean): void {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
      statusElement.textContent = connected ? 'Connected' : 'Disconnected';
      statusElement.className = connected ? 'connected' : 'disconnected';
    }
  }

  private showGameOverScreen(winner: string, score: number): void {
    // Hide game canvas
    const gameContainer = document.getElementById('gameContainer');
    if (gameContainer) gameContainer.style.display = 'none';

    // Create game over screen
    const gameOverScreen = document.createElement('div');
    gameOverScreen.id = 'gameOverScreen';
    gameOverScreen.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      color: white;
      font-family: 'Courier New', monospace;
      z-index: 1000;
    `;

    const message = winner === this.gameState.playerRole ? 'You Win!' : 'Game Over!';
    gameOverScreen.innerHTML = `
      <div style="text-align: center;">
        <h1 style="font-size: 3em; margin: 0; color: ${winner === this.gameState.playerRole ? '#00FF00' : '#FF0000'};">${message}</h1>
        <p style="font-size: 1.5em; margin: 20px 0;">Winner: ${winner.toUpperCase()}</p>
        <p style="font-size: 1.2em; margin: 20px 0;">Final Score: ${score}</p>
        <div style="margin-top: 40px;">
          <button id="restartButton" style="
            padding: 15px 30px;
            font-size: 1.2em;
            margin: 0 10px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-family: 'Courier New', monospace;
          ">Play Again</button>
          <button id="backToLobbyButton" style="
            padding: 15px 30px;
            font-size: 1.2em;
            margin: 0 10px;
            background: #2196F3;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-family: 'Courier New', monospace;
          ">Back to Lobby</button>
        </div>
      </div>
    `;

    document.body.appendChild(gameOverScreen);

    // Add event listeners
    const restartButton = document.getElementById('restartButton');
    const backToLobbyButton = document.getElementById('backToLobbyButton');

    if (restartButton) {
      restartButton.addEventListener('click', () => this.restartGame());
    }

    if (backToLobbyButton) {
      backToLobbyButton.addEventListener('click', () => this.backToLobby());
    }
  }

  private restartGame(): void {
    // Reset game state
    this.gameState.gameStarted = false;
    this.gameState.gameOver = false;
    this.gameState.score = 0;
    this.gameState.pelletsRemaining = 0;

    // Remove game over screen
    const gameOverScreen = document.getElementById('gameOverScreen');
    if (gameOverScreen) {
      gameOverScreen.remove();
    }

    // Show waiting room
    this.showWaitingRoom();

    // Request restart from server if user is Pac-Man
    if (this.gameState.playerRole === 'pacman') {
      this.socket.emit('restart_game');
    }
  }

  private backToLobby(): void {
    // Reset game state
    this.gameState.gameStarted = false;
    this.gameState.gameOver = false;
    this.gameState.playerId = null;
    this.gameState.playerRole = null;
    this.gameState.players = {};

    // Remove game over screen
    const gameOverScreen = document.getElementById('gameOverScreen');
    if (gameOverScreen) {
      gameOverScreen.remove();
    }

    // Show room selection
    this.showRoomSelection();

    // Clear name input
    const nameInput = document.getElementById('playerName') as HTMLInputElement;
    if (nameInput) nameInput.value = '';

    // Disconnect and reconnect to get fresh state
    this.socket.emit('leave_game');
  }

  private playBackgroundMusic(): void {
    const bgMusic = document.getElementById('backgroundMusic') as HTMLAudioElement;
    if (bgMusic) {
      bgMusic.volume = 0.3;
      bgMusic.play().catch(e => console.log('Audio play failed:', e));
    }
  }

  private stopBackgroundMusic(): void {
    const bgMusic = document.getElementById('backgroundMusic') as HTMLAudioElement;
    if (bgMusic) {
      bgMusic.pause();
    }
  }

  private playPowerUpSound(): void {
    const powerUpSound = document.getElementById('powerUpSound') as HTMLAudioElement;
    if (powerUpSound) {
      powerUpSound.volume = 0.7;
      powerUpSound.play().catch(e => console.log('Audio play failed:', e));
    }
  }

  private playPelletSound(): void {
    const pelletSound = document.getElementById('pelletSound') as HTMLAudioElement;
    if (pelletSound) {
      pelletSound.volume = 0.5;
      pelletSound.play().catch(e => console.log('Audio play failed:', e));
    }
  }

  private requestRoomsList(): void {
    this.socket.emit('list_rooms');
  }

  private updateRoomsList(): void {
    const roomsList = document.getElementById('roomsList');
    if (!roomsList) return;

    if (this.gameState.rooms.length === 0) {
      roomsList.innerHTML = '<div class="loading">No rooms available</div>';
      return;
    }

    roomsList.innerHTML = '';
    this.gameState.rooms.forEach(room => {
      const roomItem = document.createElement('div');
      roomItem.className = 'room-item';
      roomItem.innerHTML = `
        <div class="room-info">
          <div class="room-name">${room.name}</div>
          <div class="room-details">Players: ${room.playerCount}/${room.maxPlayers}</div>
        </div>
        <div class="room-status ${this.getRoomStatusClass(room)}">${this.getRoomStatusText(room)}</div>
        <button class="btn btn-primary room-join-btn" 
                ${room.playerCount >= room.maxPlayers || room.isStarted ? 'disabled' : ''}
                onclick="game.joinSpecificRoom('${room.id}')">
          JOIN
        </button>
      `;
      roomsList.appendChild(roomItem);
    });
  }

  private getRoomStatusClass(room: RoomInfo): string {
    if (room.playerCount >= room.maxPlayers) return 'full';
    if (room.isStarted) return 'playing';
    return 'waiting';
  }

  private getRoomStatusText(room: RoomInfo): string {
    if (room.playerCount >= room.maxPlayers) return 'FULL';
    if (room.isStarted) return 'PLAYING';
    return 'WAITING';
  }

  private quickJoin(): void {
    this.gameState.selectedRoom = 'default'; // Default room
    this.showJoinForm();
  }

  private joinRoomByCode(): void {
    const roomCodeInput = document.getElementById('roomCodeInput') as HTMLInputElement;
    const roomCode = roomCodeInput?.value.trim();

    if (!roomCode) {
      alert('Please enter a room code');
      return;
    }

    // Store the room code and show join form
    this.gameState.selectedRoom = roomCode;
    this.showJoinForm();
  }

  private showCreateRoomForm(): void {
    this.hideAllScreens();
    const createRoomForm = document.getElementById('createRoomForm');
    if (createRoomForm) createRoomForm.style.display = 'block';
  }

  private showRoomSelection(): void {
    this.hideAllScreens();
    const roomSelection = document.getElementById('roomSelection');
    if (roomSelection) roomSelection.style.display = 'block';
  }

  private showJoinForm(): void {
    this.hideAllScreens();
    const joinForm = document.getElementById('joinForm');
    if (joinForm) joinForm.style.display = 'block';
  }

  private hideAllScreens(): void {
    const screens = ['roomSelection', 'createRoomForm', 'joinForm', 'waitingRoom', 'gameContainer'];
    screens.forEach(screenId => {
      const screen = document.getElementById(screenId);
      if (screen) screen.style.display = 'none';
    });
  }

  private createRoom(): void {
    const roomNameInput = document.getElementById('newRoomName') as HTMLInputElement;
    const hostNameInput = document.getElementById('hostPlayerName') as HTMLInputElement;

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

    this.socket.emit('create_room', { name: hostName, roomName: roomName });
  }

  public joinSpecificRoom(roomId: string): void {
    this.gameState.selectedRoom = roomId;
    this.showJoinForm();
  }
}

// Global game instance for HTML onclick handlers
let game: PacManGame;

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  game = new PacManGame();
});
