"use strict";
class PacManGame {
    constructor() {
        this.CELL_SIZE = 30;
        this.MAZE_WIDTH = 20;
        this.MAZE_HEIGHT = 19;
        this.animationFrame = null;
        // Colors
        this.COLORS = {
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
        this.initializeCanvas();
        this.initializeGameState();
        this.connectToServer();
        this.setupEventListeners();
        this.startGameLoop();
    }
    initializeCanvas() {
        this.canvas = document.getElementById('gameCanvas');
        if (!this.canvas) {
            throw new Error('Game canvas not found');
        }
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = this.MAZE_WIDTH * this.CELL_SIZE;
        this.canvas.height = this.MAZE_HEIGHT * this.CELL_SIZE;
    }
    initializeGameState() {
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
    connectToServer() {
        this.socket = io({
            transports: ['websocket', 'polling'],
            timeout: 10000,
            forceNew: true
        });
        this.setupSocketEvents();
    }
    setupSocketEvents() {
        this.socket.on('connect', () => {
            console.log('Connected to server successfully');
            this.updateConnectionStatus(true);
        });
        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.updateConnectionStatus(false);
        });
        this.socket.on('disconnect', (reason) => {
            console.log('Disconnected from server:', reason);
            this.updateConnectionStatus(false);
        });
        this.socket.on('join_success', (data) => {
            this.gameState.playerId = data.player_id;
            this.gameState.playerRole = data.role;
            this.updateGameState(data.game_state);
            this.showWaitingRoom();
        });
        this.socket.on('join_failed', (data) => {
            alert('Failed to join game: ' + data.reason);
        });
        this.socket.on('player_joined', (data) => {
            this.gameState.players[data.player.id] = data.player;
            this.updatePlayersDisplay();
            this.updateStartButton(data.can_start);
        });
        this.socket.on('player_left', (data) => {
            delete this.gameState.players[data.player_id];
            this.updatePlayersDisplay();
        });
        this.socket.on('game_started', () => {
            this.gameState.gameStarted = true;
            this.showGameCanvas();
            this.playBackgroundMusic();
        });
        this.socket.on('player_moved', (data) => {
            if (this.gameState.players[data.player_id]) {
                this.gameState.players[data.player_id].x = data.x;
                this.gameState.players[data.player_id].y = data.y;
                this.gameState.players[data.player_id].direction = data.direction;
            }
            this.gameState.score = data.score;
            this.gameState.pelletsRemaining = data.pellets_remaining;
            this.updateGameInfo();
        });
        this.socket.on('power_up_spawned', (data) => {
            this.gameState.powerUps[data.position] = {
                type: data.type,
                spawnTime: Date.now()
            };
        });
        this.socket.on('power_up_collected', (data) => {
            delete this.gameState.powerUps[data.position];
            this.playPowerUpSound();
        });
        this.socket.on('game_over', (data) => {
            this.gameState.gameOver = true;
            this.showGameOverScreen(data.winner, data.score);
            this.stopBackgroundMusic();
        });
    }
    setupEventListeners() {
        // Keyboard controls
        document.addEventListener('keydown', (event) => {
            if (!this.gameState.gameStarted || this.gameState.gameOver)
                return;
            let direction = null;
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
        const nameInput = document.getElementById('playerName');
        if (nameInput) {
            nameInput.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    this.joinGame();
                }
            });
        }
    }
    startGameLoop() {
        const gameLoop = () => {
            this.render();
            this.animationFrame = requestAnimationFrame(gameLoop);
        };
        gameLoop();
    }
    render() {
        if (!this.gameState.gameStarted)
            return;
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
    drawMaze() {
        if (!this.gameState.maze.length)
            return;
        this.ctx.fillStyle = this.COLORS.wall;
        for (let y = 0; y < this.gameState.maze.length; y++) {
            for (let x = 0; x < this.gameState.maze[y].length; x++) {
                if (this.gameState.maze[y][x] === 1) {
                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                }
            }
        }
    }
    drawPellets() {
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
    drawPowerUps() {
        Object.entries(this.gameState.powerUps).forEach(([position, powerUp]) => {
            const [x, y] = position.split(',').map(Number);
            const centerX = x * this.CELL_SIZE + this.CELL_SIZE / 2;
            const centerY = y * this.CELL_SIZE + this.CELL_SIZE / 2;
            this.ctx.fillStyle = this.COLORS.powerUp[powerUp.type];
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }
    drawPlayers() {
        Object.values(this.gameState.players).forEach(player => {
            const centerX = player.x * this.CELL_SIZE + this.CELL_SIZE / 2;
            const centerY = player.y * this.CELL_SIZE + this.CELL_SIZE / 2;
            if (player.role === 'pacman') {
                this.ctx.fillStyle = this.COLORS.pacman;
            }
            else {
                const ghostColor = player.ghostColor;
                this.ctx.fillStyle = this.COLORS.ghost[ghostColor] || this.COLORS.ghost.red;
            }
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, this.CELL_SIZE / 2 - 2, 0, Math.PI * 2);
            this.ctx.fill();
        });
    }
    joinGame() {
        const nameInput = document.getElementById('playerName');
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
    startGame() {
        this.socket.emit('start_game');
    }
    updateGameState(gameState) {
        this.gameState.players = {};
        gameState.players.forEach((player) => {
            this.gameState.players[player.id] = player;
        });
        this.gameState.maze = gameState.maze;
        this.gameState.pellets = new Set(gameState.pellets);
        this.gameState.powerUps = gameState.power_ups;
        this.gameState.score = gameState.score;
        this.gameState.pelletsRemaining = gameState.pellets_remaining;
    }
    showWaitingRoom() {
        const joinForm = document.getElementById('joinForm');
        const waitingRoom = document.getElementById('waitingRoom');
        if (joinForm)
            joinForm.style.display = 'none';
        if (waitingRoom)
            waitingRoom.style.display = 'block';
        this.updatePlayersDisplay();
    }
    showGameCanvas() {
        const waitingRoom = document.getElementById('waitingRoom');
        const gameContainer = document.getElementById('gameContainer');
        if (waitingRoom)
            waitingRoom.style.display = 'none';
        if (gameContainer)
            gameContainer.style.display = 'block';
        this.updateGameInfo();
    }
    updatePlayersDisplay() {
        const playersList = document.getElementById('playersList');
        if (!playersList)
            return;
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
    updateStartButton(canStart) {
        const startButton = document.getElementById('startButton');
        if (!startButton)
            return;
        if (this.gameState.playerRole === 'pacman' && canStart) {
            startButton.style.display = 'block';
            startButton.disabled = false;
        }
        else {
            startButton.disabled = true;
            if (this.gameState.playerRole === 'pacman') {
                startButton.style.display = 'block';
            }
        }
    }
    updateGameInfo() {
        const scoreElement = document.getElementById('score');
        const pelletsElement = document.getElementById('pellets');
        const playersElement = document.getElementById('players');
        if (scoreElement)
            scoreElement.textContent = this.gameState.score.toString();
        if (pelletsElement)
            pelletsElement.textContent = this.gameState.pelletsRemaining.toString();
        if (playersElement)
            playersElement.textContent = Object.keys(this.gameState.players).length.toString();
    }
    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = connected ? 'Connected' : 'Disconnected';
            statusElement.className = connected ? 'connected' : 'disconnected';
        }
    }
    showGameOverScreen(winner, score) {
        const message = winner === this.gameState.playerRole ? 'You Win!' : 'Game Over!';
        alert(message + '\nWinner: ' + winner.toUpperCase() + '\nFinal Score: ' + score);
    }
    playBackgroundMusic() {
        const bgMusic = document.getElementById('backgroundMusic');
        if (bgMusic) {
            bgMusic.volume = 0.3;
            bgMusic.play().catch(e => console.log('Audio play failed:', e));
        }
    }
    stopBackgroundMusic() {
        const bgMusic = document.getElementById('backgroundMusic');
        if (bgMusic) {
            bgMusic.pause();
        }
    }
    playPowerUpSound() {
        const powerUpSound = document.getElementById('powerUpSound');
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
//# sourceMappingURL=game.js.map