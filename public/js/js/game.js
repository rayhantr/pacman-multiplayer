"use strict";
class PacManGame {
    socket;
    canvas;
    ctx;
    gameState;
    CELL_SIZE = 30;
    MAZE_WIDTH = 20;
    MAZE_HEIGHT = 19;
    animationFrame = null;
    // Colors
    COLORS = {
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
    initializeCanvas() {
        this.canvas = document.getElementById('gameCanvas');
        if (!this.canvas) {
            console.error('Canvas element not found');
            return;
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
            playerRole: null,
            selectedRoom: null,
            rooms: [],
        };
    }
    connectToServer() {
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
    setupSocketEvents() {
        // Re-enable join button on reconnection
        this.socket.on('connect', () => {
            const joinButton = document.getElementById('joinButton');
            if (joinButton && joinButton.textContent === 'JOINING...') {
                joinButton.disabled = false;
                joinButton.textContent = 'JOIN';
            }
        });
        this.socket.on('join_success', (data) => {
            console.log('Received join_success:', data);
            this.gameState.playerId = data.player_id;
            this.gameState.playerRole = data.role;
            console.log('About to update game state with:', data.game_state);
            this.updateGameState(data.game_state);
            console.log('Calling showWaitingRoom()');
            this.showWaitingRoom();
        });
        this.socket.on('join_failed', (data) => {
            alert('Failed to join game: ' + data.reason);
            // Re-enable join button
            const joinButton = document.getElementById('joinButton');
            if (joinButton) {
                joinButton.disabled = false;
                joinButton.textContent = 'JOIN';
            }
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
        this.socket.on('pellet_collected', (data) => {
            // Remove pellet from client state
            this.gameState.pellets.delete(data.position);
            this.gameState.score = data.score;
            this.gameState.pelletsRemaining = data.pellets_remaining;
            this.updateGameInfo();
            this.playPelletSound();
        });
        this.socket.on('power_up_spawned', (data) => {
            this.gameState.powerUps[data.position] = {
                type: data.type,
                spawnTime: Date.now(),
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
        this.socket.on('game_restarted', (data) => {
            this.gameState.gameStarted = false;
            this.gameState.gameOver = false;
            this.updateGameState(data.game_state);
            this.showWaitingRoom();
        });
        // Room-related events
        this.socket.on('rooms_list', (data) => {
            this.gameState.rooms = data.rooms;
            this.updateRoomsList();
        });
        this.socket.on('room_created', (data) => {
            this.gameState.selectedRoom = data.roomId;
            // Show the room code to the user
            alert(`Room created successfully!\n\nRoom Code: ${data.roomName}\n\nShare this code with friends so they can join your room.`);
            // Room creation automatically joins the room, so we should be getting join_success next
        });
    }
    setupEventListeners() {
        // Keyboard controls
        document.addEventListener('keydown', event => {
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
        const roomCodeInput = document.getElementById('roomCodeInput');
        if (roomCodeInput) {
            roomCodeInput.addEventListener('keypress', event => {
                if (event.key === 'Enter') {
                    this.joinRoomByCode();
                }
            });
        }
        const nameInputs = ['playerName', 'newRoomName', 'hostPlayerName'];
        nameInputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                input.addEventListener('keypress', event => {
                    if (event.key === 'Enter') {
                        if (inputId === 'playerName') {
                            this.joinGame();
                        }
                        else if (inputId === 'newRoomName' || inputId === 'hostPlayerName') {
                            this.createRoom();
                        }
                    }
                });
            }
        });
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
    updatePlayerInterpolation() {
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
            }
            else {
                // Initialize render position if not set
                player.renderX = player.renderX ?? player.x;
                player.renderY = player.renderY ?? player.y;
            }
        });
    }
    easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
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
            // Use interpolated positions for smooth movement
            const renderX = player.renderX ?? player.x;
            const renderY = player.renderY ?? player.y;
            const centerX = renderX * this.CELL_SIZE + this.CELL_SIZE / 2;
            const centerY = renderY * this.CELL_SIZE + this.CELL_SIZE / 2;
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
    joinGame(roomCode) {
        const nameInput = document.getElementById('playerName');
        const joinButton = document.getElementById('joinButton');
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
        const joinData = {
            name: playerName,
            roomCode: finalRoomCode,
        };
        this.socket.emit('join_game', joinData);
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
        this.gameState.powerUps = gameState.powerUps;
        this.gameState.score = gameState.score;
        this.gameState.pelletsRemaining = gameState.pelletsRemaining;
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
        // Hide game canvas
        const gameContainer = document.getElementById('gameContainer');
        if (gameContainer)
            gameContainer.style.display = 'none';
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
    restartGame() {
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
    backToLobby() {
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
        const nameInput = document.getElementById('playerName');
        if (nameInput)
            nameInput.value = '';
        // Disconnect and reconnect to get fresh state
        this.socket.emit('leave_game');
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
    playPelletSound() {
        const pelletSound = document.getElementById('pelletSound');
        if (pelletSound) {
            pelletSound.volume = 0.5;
            pelletSound.play().catch(e => console.log('Audio play failed:', e));
        }
    }
    requestRoomsList() {
        this.socket.emit('list_rooms');
    }
    updateRoomsList() {
        const roomsList = document.getElementById('roomsList');
        if (!roomsList)
            return;
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
    getRoomStatusClass(room) {
        if (room.playerCount >= room.maxPlayers)
            return 'full';
        if (room.isStarted)
            return 'playing';
        return 'waiting';
    }
    getRoomStatusText(room) {
        if (room.playerCount >= room.maxPlayers)
            return 'FULL';
        if (room.isStarted)
            return 'PLAYING';
        return 'WAITING';
    }
    quickJoin() {
        this.gameState.selectedRoom = 'default'; // Default room
        this.showJoinForm();
    }
    joinRoomByCode() {
        const roomCodeInput = document.getElementById('roomCodeInput');
        const roomCode = roomCodeInput?.value.trim();
        if (!roomCode) {
            alert('Please enter a room code');
            return;
        }
        // Store the room code and show join form
        this.gameState.selectedRoom = roomCode;
        this.showJoinForm();
    }
    showCreateRoomForm() {
        this.hideAllScreens();
        const createRoomForm = document.getElementById('createRoomForm');
        if (createRoomForm)
            createRoomForm.style.display = 'block';
    }
    showRoomSelection() {
        this.hideAllScreens();
        const roomSelection = document.getElementById('roomSelection');
        if (roomSelection)
            roomSelection.style.display = 'block';
    }
    showJoinForm() {
        this.hideAllScreens();
        const joinForm = document.getElementById('joinForm');
        if (joinForm)
            joinForm.style.display = 'block';
    }
    hideAllScreens() {
        const screens = ['roomSelection', 'createRoomForm', 'joinForm', 'waitingRoom', 'gameContainer'];
        screens.forEach(screenId => {
            const screen = document.getElementById(screenId);
            if (screen)
                screen.style.display = 'none';
        });
    }
    createRoom() {
        const roomNameInput = document.getElementById('newRoomName');
        const hostNameInput = document.getElementById('hostPlayerName');
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
    joinSpecificRoom(roomId) {
        this.gameState.selectedRoom = roomId;
        this.showJoinForm();
    }
}
// Global game instance for HTML onclick handlers
let game;
// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    game = new PacManGame();
});
//# sourceMappingURL=game.js.map