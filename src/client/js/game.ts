// TypeScript interfaces for client-side game
interface Position {
  x: number;
  y: number;
}

interface ClientPlayer {
  id: string;
  name: string;
  role: 'pacman' | 'ghost';
  ghostColor?: string | null;
  x: number;
  y: number;
  direction: string;
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
      orange: '#ffb852'
    },
    powerUp: {
      speed_boost: '#00ff00',
      invincibility: '#ff00ff',
      pellet_multiplier: '#00ffff'
    }
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
      throw new Error('Game canvas not found');
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
      playerRole: null
    };
  }

  private connectToServer(): void {
    this.socket = io({
      transports: ['websocket', 'polling'],
      timeout: 10000,
      forceNew: true
    });

    this.setupSocketEvents();
  }

  private setupSocketEvents(): void {
    this.socket.on('connect', () => {
      console.log('Connected to server successfully');
      this.updateConnectionStatus(true);
    });

    this.socket.on('connect_error', (error: any) => {
      console.error('Connection error:', error);
      this.updateConnectionStatus(false);
    });

    this.socket.on('disconnect', (reason: any) => {
      console.log('Disconnected from server:', reason);
      this.updateConnectionStatus(false);
    });

    this.socket.on('join_success', (data: any) => {
      this.gameState.playerId = data.player_id;
      this.gameState.playerRole = data.role;
      this.updateGameState(data.game_state);
      this.showWaitingRoom();
    });

    this.socket.on('join_failed', (data: any) => {
      alert('Failed to join game: ' + data.reason);
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
        this.gameState.players[data.player_id].x = data.x;
        this.gameState.players[data.player_id].y = data.y;
        this.gameState.players[data.player_id].direction = data.direction;
      }
      
      this.gameState.score = data.score;
      this.gameState.pelletsRemaining = data.pellets_remaining;
      this.updateGameInfo();
    });

    this.socket.on('power_up_spawned', (data: any) => {
      this.gameState.powerUps[data.position] = {
        type: data.type,
        spawnTime: Date.now()
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
  }

  private setupEventListeners(): void {
    // Keyboard controls
    document.addEventListener('keydown', (event) => {
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

    // Join game button
    const joinButton = document.getElementById('joinButton');
    if (joinButton) {
      joinButton.addEventListener('click', () => this.joinGame());
    }

    // Start game button
    const startButton = document.getElementById('startButton');
    if (startButton) {
      startButton.addEventListener('click', () => this.startGame());
    }

    // Enter key in name input
    const nameInput = document.getElementById('playerName') as HTMLInputElement;
    if (nameInput) {
      nameInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
          this.joinGame();
        }
      });
    }
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

    // Draw maze
    this.drawMaze();
    
    // Draw pellets
    this.drawPellets();
    
    // Draw power-ups
    this.drawPowerUps();
    
    // Draw players
    this.drawPlayers();
  }

  private drawMaze(): void {
    if (!this.gameState.maze.length) return;

    this.ctx.fillStyle = this.COLORS.wall;
    for (let y = 0; y < this.gameState.maze.length; y++) {
      for (let x = 0; x < this.gameState.maze[y].length; x++) {
        if (this.gameState.maze[y][x] === 1) {
          this.ctx.fillRect(
            x * this.CELL_SIZE,
            y * this.CELL_SIZE,
            this.CELL_SIZE,
            this.CELL_SIZE
          );
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
      const centerX = player.x * this.CELL_SIZE + this.CELL_SIZE / 2;
      const centerY = player.y * this.CELL_SIZE + this.CELL_SIZE / 2;
      
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

  public joinGame(): void {
    const nameInput = document.getElementById('playerName') as HTMLInputElement;
    const playerName = nameInput?.value.trim();
    
    if (!playerName) {
      alert('Please enter your name');
      return;
    }

    if (!this.socket.connected) {
      alert('Not connected to server. Please wait for connection or refresh the page.');
      return;
    }

    this.socket.emit('join_game', { name: playerName });
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
    this.gameState.powerUps = gameState.power_ups;
    this.gameState.score = gameState.score;
    this.gameState.pelletsRemaining = gameState.pellets_remaining;
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
    if (playersElement) playersElement.textContent = Object.keys(this.gameState.players).length.toString();
  }

  private updateConnectionStatus(connected: boolean): void {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
      statusElement.textContent = connected ? 'Connected' : 'Disconnected';
      statusElement.className = connected ? 'connected' : 'disconnected';
    }
  }

  private showGameOverScreen(winner: string, score: number): void {
    const message = winner === this.gameState.playerRole ? 'You Win!' : 'Game Over!';
    alert(message + '\nWinner: ' + winner.toUpperCase() + '\nFinal Score: ' + score);
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
}

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PacManGame();
});

