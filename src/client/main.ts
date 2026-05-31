import './styles.css';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientGameState,
  ClientToServerEvents,
  Direction,
  EffectType,
  Role,
  RoomInfo,
  ServerToClientEvents,
} from '../shared/types';
import { MAX_GHOSTS, MAX_PACMAN } from '../shared/types';
import { DEFAULT_MAP_ID, isMapLocked, mapInfos } from '../shared/maps';
import { COLORS } from './core/constants';
import type { LocalGameState } from './core/types';
import { Renderer } from './rendering/renderer';
import { Effects, vibrate } from './rendering/effects';
import { AudioController } from './ui/audio';
import { showToast, showConfirm } from './ui/dialogs';
import { createIcon, hydrateIcons } from './ui/icons';

class PacManGame {
  private socket!: Socket<ServerToClientEvents, ClientToServerEvents>;
  private gameState!: LocalGameState;

  // Collaborators: canvas rendering, game-feel effects, and audio are each their
  // own module; this class orchestrates them around sockets, UI flow, and input.
  private readonly renderer = new Renderer();
  private readonly effects = new Effects();
  private readonly audio = new AudioController();

  // While the help tooltip is open, this closes it on outside-click/Escape.
  private helpCloseHandler: ((event: Event) => void) | null = null;

  // True when this client owns the room (first joiner): controls start/restart.
  private isHost = false;

  // Role chosen on the join/create screen (re-pickable in the lobby).
  private selectedRole: Role = 'pacman';

  // Lobby map-vote state, mirrored from the server's lobby_map_state broadcasts.
  private mapVotes: Record<string, number> = {};
  // The leading map (server-decided) — the board that will actually play.
  private selectedMapId: string = DEFAULT_MAP_ID;
  // This client's own vote (null until they pick), shown as the "your pick" highlight.
  private myMapVote: string | null = null;

  constructor() {
    hydrateIcons(); // swap the static [data-icon] placeholders for inline SVG
    this.initializeGameState();
    this.connectToServer();
    this.setupEventListeners();
    this.startGameLoop();
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
      // The server may have overridden the requested role to honor caps.
      this.selectedRole = data.role === 'ghost' ? 'ghost' : 'pacman';
      this.isHost = data.is_host;
      this.updateGameState(data.game_state);
      this.showWaitingRoom();
    });

    this.socket.on('join_failed', data => {
      showToast('Failed to join game: ' + data.reason, 'error');
      const joinButton = document.getElementById('joinButton') as HTMLButtonElement | null;
      if (joinButton) {
        joinButton.disabled = false;
        joinButton.textContent = 'JOIN';
      }
    });

    this.socket.on('player_joined', data => {
      this.gameState.players[data.player.id] = { ...data.player };
      this.updatePlayersDisplay();
      this.updateMapVotePanel();
      this.updateStartButton(data.can_start);
    });

    this.socket.on('player_left', data => {
      delete this.gameState.players[data.player_id];
      this.updatePlayersDisplay();
      this.updateMapVotePanel();
    });

    this.socket.on('player_role_changed', data => {
      const player = this.gameState.players[data.player_id];
      if (player) {
        player.role = data.role;
        player.ghostColor = data.ghostColor ?? null;
        player.pacmanColor = data.pacmanColor ?? null;
      }
      if (data.player_id === this.gameState.playerId) {
        this.gameState.playerRole = data.role;
        this.renderColorPicker(); // the available palette changed with the role
      }
      this.updatePlayersDisplay();
      this.updateStartButton(data.can_start);
    });

    this.socket.on('player_color_changed', data => {
      const player = this.gameState.players[data.player_id];
      if (player) {
        player.ghostColor = data.ghostColor ?? null;
        player.pacmanColor = data.pacmanColor ?? null;
      }
      if (data.player_id === this.gameState.playerId) {
        this.renderColorPicker();
      }
      // Re-render the player list so the role icon reflects the new color tint.
      this.updatePlayersDisplay();
    });

    this.socket.on('role_change_failed', data => {
      showToast(data.reason, 'error');
    });

    this.socket.on('lobby_map_state', data => {
      this.mapVotes = { ...data.votes };
      this.selectedMapId = data.selectedMapId;
      this.updateMapVotePanel();
    });

    this.socket.on('start_failed', data => {
      showToast(data.reason, 'error');
    });

    this.socket.on('player_converted', data => {
      const player = this.gameState.players[data.player_id];
      if (player) {
        player.role = 'ghost';
        player.ghostColor = data.ghostColor ?? null;
        player.pacmanColor = null;
        // Snap to the ghost spawn — no interpolation across the teleport.
        player.x = data.x;
        player.y = data.y;
        player.targetX = data.x;
        player.targetY = data.y;
        player.renderX = data.x;
        player.renderY = data.y;
        delete player.lastMoveTime;
        delete player.activePowerUps;
      }
      if (data.player_id === this.gameState.playerId) {
        this.gameState.playerRole = 'ghost';
        this.applyHudRoleClass();
        this.updatePowerUpTimers();
      }
      vibrate(40);
    });

    this.socket.on('game_started', data => {
      // The board (selected map, spawns, colors) is finalized at start.
      this.updateGameState(data.game_state);
      this.gameState.gameStarted = true;
      this.showGameCanvas();
      this.audio.playBackgroundMusic();
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
      this.audio.playPelletSound();

      // Juice: a small amber burst + a light haptic tick where the pellet was.
      const [x, y] = data.position.split(',').map(Number);
      this.effects.spawnBurst(x!, y!, COLORS.pellet, 8);
      vibrate(12);
    });

    this.socket.on('power_up_spawned', data => {
      this.gameState.powerUps[data.position] = {
        type: data.type,
        owner: data.owner,
        spawnTime: Date.now(),
      };
    });

    this.socket.on('power_up_despawned', data => {
      // Boost expired uncollected; the renderer drops the sprite next frame.
      delete this.gameState.powerUps[data.position];
    });

    // Cosmetic only: drop the board sprite, play SFX, spark a burst. The actual
    // effect on a player is driven by effect_applied (which also covers `frozen`,
    // applied to a player OTHER than the collector).
    this.socket.on('power_up_collected', data => {
      delete this.gameState.powerUps[data.position];
      this.audio.playPowerUpSound();
      const [x, y] = data.position.split(',').map(Number);
      this.effects.spawnBurst(x!, y!, COLORS.powerUp[data.type], 14);
      vibrate(30);
    });

    this.socket.on('effect_applied', data => {
      const player = this.gameState.players[data.player_id];
      if (player) {
        const duration = Math.max(0, data.endTime - Date.now());
        player.activePowerUps = player.activePowerUps ?? {};
        player.activePowerUps[data.effect] = { endTime: data.endTime, duration };
      }
      if (data.player_id === this.gameState.playerId) {
        if (data.effect === 'frozen') {
          vibrate([30, 40, 30]);
        }
        this.updatePowerUpTimers();
      }
    });

    this.socket.on('effect_expired', data => {
      const player = this.gameState.players[data.player_id];
      if (player?.activePowerUps) {
        delete player.activePowerUps[data.effect];
      }
      if (data.player_id === this.gameState.playerId) {
        this.updatePowerUpTimers();
      }
    });

    this.socket.on('game_over', data => {
      this.gameState.gameOver = true;
      this.audio.stopBackgroundMusic();
      vibrate([40, 60, 120]);

      if (data.winner === 'ghosts') {
        // Caught: play the death shrink + screenshake before showing the overlay.
        const pacman = Object.values(this.gameState.players).find(p => p.role === 'pacman');
        if (pacman) {
          this.effects.triggerDeath(
            pacman.renderX ?? pacman.x,
            pacman.renderY ?? pacman.y,
            COLORS.pacman
          );
        }
        this.effects.triggerShake(320, 0.28);
        window.setTimeout(() => this.showGameOverScreen(data.winner, data.score), 900);
      } else {
        this.showGameOverScreen(data.winner, data.score);
      }
    });

    this.socket.on('game_restarted', data => {
      this.gameState.gameStarted = false;
      this.gameState.gameOver = false;
      this.effects.reset();
      this.updateGameState(data.game_state);
      this.updatePowerUpTimers();
      this.showWaitingRoom();
    });

    this.socket.on('rooms_list', data => {
      this.gameState.rooms = [...data.rooms];
      this.updateRoomsList();
    });

    this.socket.on('room_created', data => {
      this.gameState.selectedRoom = data.roomId;
      showToast(`Room "${data.roomName}" created — share this code so friends can join.`, 'info');
      // Room creation automatically joins the room; join_success follows.
    });
  }

  private setupEventListeners(): void {
    document.addEventListener('keydown', event => {
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

      // Only act on arrows during active play, so menu/text inputs keep their
      // native caret navigation. Auto-repeat (holding a key) is intentional and
      // mirrors the touch D-pad; the server move cooldown rate-limits it.
      if (direction && this.gameState.gameStarted && !this.gameState.gameOver) {
        event.preventDefault();
        this.sendMove(direction);
      }
    });

    // Re-fit the canvas to the viewport while a game is on screen.
    window.addEventListener('resize', () => {
      if (document.body.classList.contains('game-active')) {
        this.renderer.resize(this.gameState.maze);
      }
    });

    // Split, handheld-style touch pad: left/right on one side, up/down on the other.
    this.bindHold('dpadUp', 'up');
    this.bindHold('dpadDown', 'down');
    this.bindHold('dpadLeft', 'left');
    this.bindHold('dpadRight', 'right');

    this.setupRoleChoosers();

    this.bindClick('joinRoomButton', () => this.joinRoomByCode());
    this.bindClick('quickJoinButton', () => this.quickJoin());
    this.bindClick('createRoomButton', () => this.showCreateRoomForm());
    this.bindClick('createRoomConfirmButton', () => this.createRoom());
    this.bindClick('backToRoomsButton', () => this.showRoomSelection());
    this.bindClick('joinButton', () => this.joinGame());
    this.bindClick('backToRoomsFromJoinButton', () => this.showRoomSelection());
    this.bindClick('startButton', () => this.startGame());
    this.bindClick('exitGameButton', () =>
      showConfirm(
        'Leave the game and return to the lobby?',
        () => this.backToLobby(),
        'Leave',
        'Stay'
      )
    );
    this.bindClick('muteButton', () => this.audio.toggleMute());
    this.bindClick('helpButton', () => this.toggleHelp());

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

  /** Wire the Pac-Man/Ghost segmented choosers on the join and create screens. */
  private setupRoleChoosers(): void {
    ['joinRoleChooser', 'createRoleChooser'].forEach(id => {
      const chooser = document.getElementById(id);
      chooser?.querySelectorAll<HTMLButtonElement>('.role-option').forEach(button => {
        button.addEventListener('click', () => {
          const role = button.dataset['role'];
          if (role === 'pacman' || role === 'ghost') {
            this.setSelectedRole(role);
          }
        });
      });
    });
    this.setSelectedRole(this.selectedRole); // paint the initial selection
  }

  /** Record the chosen join role and reflect it on both choosers' active state. */
  private setSelectedRole(role: Role): void {
    this.selectedRole = role;
    document.querySelectorAll<HTMLButtonElement>('.role-chooser .role-option').forEach(button => {
      button.classList.toggle('is-active', button.dataset['role'] === role);
      button.setAttribute('aria-pressed', String(button.dataset['role'] === role));
    });
  }

  /**
   * Toggle the "How it works" help tooltip on click/tap (hover is handled in
   * CSS). While open, an outside click or Escape closes it.
   */
  private toggleHelp(): void {
    if (this.helpCloseHandler) {
      this.closeHelp();
      return;
    }

    const tooltip = document.getElementById('helpTooltip');
    const button = document.getElementById('helpButton');
    if (!tooltip || !button) {
      return;
    }

    tooltip.classList.add('is-open');
    tooltip.setAttribute('aria-hidden', 'false');
    button.setAttribute('aria-expanded', 'true');

    this.helpCloseHandler = (event: Event): void => {
      if (event.type === 'keydown') {
        if ((event as KeyboardEvent).key === 'Escape') {
          this.closeHelp();
        }
        return;
      }
      // Clicks inside the help corner (button or tooltip) keep it open.
      if (!document.getElementById('helpCorner')?.contains(event.target as Node)) {
        this.closeHelp();
      }
    };

    // Capture phase so we see the click before it can re-trigger the button.
    document.addEventListener('click', this.helpCloseHandler, true);
    document.addEventListener('keydown', this.helpCloseHandler, true);
  }

  private closeHelp(): void {
    document.getElementById('helpTooltip')?.classList.remove('is-open');
    document.getElementById('helpTooltip')?.setAttribute('aria-hidden', 'true');
    document.getElementById('helpButton')?.setAttribute('aria-expanded', 'false');
    if (this.helpCloseHandler) {
      document.removeEventListener('click', this.helpCloseHandler, true);
      document.removeEventListener('keydown', this.helpCloseHandler, true);
      this.helpCloseHandler = null;
    }
  }

  /** Bind a touch-pad button so press-and-hold repeats the move, mirroring keyboard auto-repeat. */
  private bindHold(elementId: string, direction: Direction): void {
    const el = document.getElementById(elementId);
    if (!el) {
      return;
    }

    let intervalId: number | null = null;
    const stop = (): void => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const start = (event: PointerEvent): void => {
      event.preventDefault();
      this.sendMove(direction);
      stop();
      intervalId = window.setInterval(() => this.sendMove(direction), 120);
    };

    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('pointerleave', stop);
  }

  private sendMove(direction: Direction): void {
    if (!this.gameState.gameStarted || this.gameState.gameOver) {
      return;
    }
    this.socket.emit('player_move', { direction });
  }

  private startGameLoop(): void {
    const gameLoop = (): void => {
      const now = Date.now();
      this.renderer.render(this.gameState, this.effects, now);
      this.updateTimerBars(now);
      requestAnimationFrame(gameLoop);
    };
    gameLoop();
  }

  public joinGame(roomCode?: string): void {
    const nameInput = document.getElementById('playerName') as HTMLInputElement | null;
    const joinButton = document.getElementById('joinButton') as HTMLButtonElement | null;
    const playerName = nameInput?.value.trim();

    if (!playerName) {
      showToast('Please enter your name', 'error');
      return;
    }

    if (!this.socket.connected) {
      showToast('Not connected to server. Please wait or refresh the page.', 'error');
      return;
    }

    if (joinButton) {
      joinButton.disabled = true;
      joinButton.textContent = 'JOINING...';
    }

    const finalRoomCode = roomCode ?? this.gameState.selectedRoom ?? 'default';
    this.socket.emit('join_game', {
      name: playerName,
      roomCode: finalRoomCode,
      role: this.selectedRole,
    });
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
      this.gameState.powerUps[position] = {
        type: powerUp.type,
        owner: powerUp.owner,
        spawnTime: powerUp.spawnTime,
      };
    }
    this.gameState.score = gameState.score;
    this.gameState.pelletsRemaining = gameState.pelletsRemaining;
  }

  private showWaitingRoom(): void {
    this.hideAllScreens();
    // Drop any lingering game-over overlay (e.g. a non-host returning to the
    // lobby via the server's game_restarted broadcast).
    document.getElementById('gameOverScreen')?.remove();
    this.revealScreen('waitingRoom');
    this.updatePlayersDisplay();
    this.renderColorPicker();
    this.updateMapVotePanel();
  }

  private showGameCanvas(): void {
    this.hideAllScreens();
    document.getElementById('gameOverScreen')?.remove();
    const gameContainer = document.getElementById('gameContainer');
    if (gameContainer) {
      gameContainer.style.display = 'block';
    }
    document.body.classList.add('game-active');
    this.applyHudRoleClass();
    this.updateGameInfo();
    // Size after the immersive flex layout has applied so the container has
    // its final dimensions to measure against.
    requestAnimationFrame(() => this.renderer.resize(this.gameState.maze));
  }

  /** Tint the in-game HUD by the local player's current role (Feature 4). */
  private applyHudRoleClass(): void {
    document.body.classList.remove('role-pacman', 'role-ghost');
    if (this.gameState.playerRole === 'pacman' || this.gameState.playerRole === 'ghost') {
      document.body.classList.add(`role-${this.gameState.playerRole}`);
    }
  }

  private updatePlayersDisplay(): void {
    const playersList = document.getElementById('playersList');
    if (!playersList) {
      return;
    }

    playersList.textContent = '';
    Object.values(this.gameState.players).forEach(player => {
      const isLocal = player.id === this.gameState.playerId;

      const playerDiv = document.createElement('div');
      playerDiv.className = `player-item`;

      // The role icon conveys the role, so the name shows on its own.
      const name = document.createElement('div');
      name.className = `player-name player-${player.role}`;
      name.textContent = isLocal ? `${player.name} (you)` : player.name;
      playerDiv.appendChild(name);

      // Icon shows the player's current role as a filled SVG, tinted by the
      // player's chosen color (falling back to the role's default).
      const icon = createIcon(player.role, 'role-icon', { filled: true });
      if (player.role === 'pacman') {
        const c = player.pacmanColor as keyof typeof COLORS.pacmanColors;
        icon.style.color = COLORS.pacmanColors[c] ?? COLORS.pacman;
      } else {
        const c = player.ghostColor as keyof typeof COLORS.ghost;
        icon.style.color = COLORS.ghost[c] ?? COLORS.ghost.red;
      }

      if (isLocal) {
        // The local player's icon doubles as a button that switches their role.
        const target = player.role === 'pacman' ? 'ghost' : 'pacman';
        const toggle = document.createElement('button');
        toggle.className = 'role-toggle';
        toggle.type = 'button';
        // Disable the switch when the target role is already at its cap.
        const targetFull =
          this.countRole(target) >= (target === 'pacman' ? MAX_PACMAN : MAX_GHOSTS);
        toggle.disabled = targetFull;
        toggle.title = targetFull
          ? `${target === 'pacman' ? 'Pac-Men' : 'Ghosts'} are full`
          : target === 'pacman'
            ? 'Switch to Pac-Man'
            : 'Switch to Ghost';
        toggle.setAttribute('aria-label', toggle.title);
        toggle.appendChild(icon);
        toggle.addEventListener('click', () => this.socket.emit('set_role', { role: target }));
        playerDiv.appendChild(toggle);
      } else {
        icon.setAttribute('aria-label', `${player.name} is a ${player.role}`);
        playerDiv.appendChild(icon);
      }

      playersList.appendChild(playerDiv);
    });
  }

  /** Count lobby players currently in a given role. */
  private countRole(role: Role): number {
    return Object.values(this.gameState.players).filter(p => p.role === role).length;
  }

  /** Render swatches of the local player's current-role palette (Feature 4). */
  private renderColorPicker(): void {
    const container = document.getElementById('colorPicker');
    if (!container) {
      return;
    }
    container.textContent = '';

    const role = this.gameState.playerRole;
    if (role !== 'pacman' && role !== 'ghost') {
      return;
    }
    const me = this.gameState.playerId ? this.gameState.players[this.gameState.playerId] : null;
    const palette = role === 'pacman' ? COLORS.pacmanColors : COLORS.ghost;
    const current = role === 'pacman' ? me?.pacmanColor : me?.ghostColor;

    (Object.entries(palette) as [string, string][]).forEach(([name, hex]) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = hex;
      swatch.title = name;
      swatch.setAttribute('aria-label', `Color ${name}`);
      if (name === current) {
        swatch.classList.add('is-active');
      }
      swatch.addEventListener('click', () => this.socket.emit('set_color', { color: name }));
      container.appendChild(swatch);
    });
  }

  /** Render the map-vote cards: vote counts, lock state, this client's own pick
   *  (highlighted), and the current leader (badged). (Feature 1) */
  private updateMapVotePanel(): void {
    const container = document.getElementById('mapVoteList');
    if (!container) {
      return;
    }
    container.textContent = '';

    const playerCount = Object.keys(this.gameState.players).length;

    mapInfos().forEach(info => {
      const locked = isMapLocked(info, playerCount);
      const votes = this.mapVotes[info.id] ?? 0;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'map-card';
      card.setAttribute('role', 'listitem');
      // Your own pick is highlighted; the current leader (server-decided) is badged.
      if (info.id === this.myMapVote && !locked) {
        card.classList.add('is-selected');
      }
      const isLeader = info.id === this.selectedMapId && !locked;
      if (isLeader) {
        card.classList.add('is-leading');
      }
      if (locked) {
        card.classList.add('is-locked');
        card.disabled = true;
      }

      const name = document.createElement('div');
      name.className = 'map-card-name';
      name.textContent = info.name;

      const meta = document.createElement('div');
      meta.className = 'map-card-meta';
      meta.textContent = `${info.size === 'small' ? 'Small' : 'Large'} · ${info.width}×${info.height} · max ${info.maxPlayers}`;

      const tally = document.createElement('div');
      tally.className = 'map-card-votes';
      if (locked) {
        tally.textContent = 'Too many players';
      } else {
        tally.append(createIcon('arrow-up', 'vote-arrow'), document.createTextNode(` ${votes}`));
        if (isLeader) {
          // The leader marker sits at the end of the vote-count line.
          const badge = document.createElement('span');
          badge.className = 'map-card-leader';
          badge.textContent = 'Leading';
          tally.append(badge);
        }
      }

      card.append(name, meta, tally);
      if (!locked) {
        // Record the local pick for an instant highlight, then sync the vote.
        card.addEventListener('click', () => {
          this.myMapVote = info.id;
          this.socket.emit('vote_map', { mapId: info.id });
          this.updateMapVotePanel();
        });
      }
      container.appendChild(card);
    });
  }

  private updateStartButton(canStart: boolean): void {
    const startButton = document.getElementById('startButton') as HTMLButtonElement | null;
    if (!startButton) {
      return;
    }

    // Only the host can start; non-hosts never see the button.
    if (this.isHost) {
      startButton.style.display = 'block';
      startButton.disabled = !canStart;
    } else {
      startButton.style.display = 'none';
    }
  }

  private updateGameInfo(): void {
    const score = this.gameState.score.toString();
    const pellets = this.gameState.pelletsRemaining.toString();
    const players = Object.keys(this.gameState.players).length.toString();

    // Pop the score when it changes (restart the CSS animation via a reflow).
    const scoreEl = document.getElementById('gameScore');
    if (scoreEl && scoreEl.textContent !== score) {
      scoreEl.classList.remove('pop');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('pop');
    }

    this.setText('gameScore', score);
    this.setText('gamePellets', pellets);
    this.setText('gamePlayers', players);
  }

  /** Rebuild the local player's power-up timer chips in the HUD. */
  private updatePowerUpTimers(): void {
    const container = document.getElementById('powerupTimers');
    if (!container) {
      return;
    }

    const me = this.gameState.playerId ? this.gameState.players[this.gameState.playerId] : null;
    const active = me?.activePowerUps;
    container.textContent = '';
    if (!active) {
      return;
    }

    // Human-readable name (used for the accessible label / tooltip) plus a
    // small inline-SVG glyph per effect. SVGs inherit the chip's per-effect
    // colour via currentColor (see the .pu-<type> rules in styles.css).
    const labels: Record<EffectType, string> = {
      speed: 'Speed',
      invincibility: 'Shield',
      pellet_multiplier: '2× Score',
      magnet: 'Magnet',
      phase: 'Phase',
      frozen: 'Frozen',
    };

    (Object.keys(active) as EffectType[]).forEach(type => {
      const effect = active[type]!;
      const chip = document.createElement('div');
      chip.className = `pu-chip pu-${type}`;
      chip.setAttribute('aria-label', labels[type]);
      chip.title = labels[type];

      // The glyph (from the shared icon registry) inherits the chip's per-effect
      // colour via currentColor (see the .pu-<type> rules in styles.css).
      const icon = createIcon(type, 'pu-icon');

      const bar = document.createElement('span');
      bar.className = 'pu-bar';
      const fill = document.createElement('span');
      fill.className = 'pu-fill';
      fill.dataset.endtime = String(effect.endTime);
      fill.dataset.duration = String(effect.duration);
      bar.appendChild(fill);

      chip.append(icon, bar);
      container.appendChild(chip);
    });
  }

  /** Deplete the timer-chip bars each frame; cheap (only a handful of elements). */
  private updateTimerBars(now: number): void {
    const fills = document.querySelectorAll<HTMLElement>('#powerupTimers .pu-fill');
    fills.forEach(fill => {
      const end = Number(fill.dataset.endtime);
      const duration = Number(fill.dataset.duration);
      const remaining = Math.max(0, end - now);
      fill.style.width = duration > 0 ? `${(remaining / duration) * 100}%` : '0%';
    });
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
      const label = connected ? 'Connected' : 'Disconnected';
      statusElement.className = connected ? 'connected' : 'disconnected';
      statusElement.title = label;
      statusElement.setAttribute('aria-label', `Connection status: ${label.toLowerCase()}`);
    }
  }

  private showGameOverScreen(winner: 'pacman' | 'ghosts', score: number): void {
    const gameContainer = document.getElementById('gameContainer');
    if (gameContainer) {
      gameContainer.style.display = 'none';
    }

    // Map the player's role to its team so ghosts ('ghost') match the winner
    // token ('ghosts') and correctly see the win screen.
    const myTeam = this.gameState.playerRole === 'pacman' ? 'pacman' : 'ghosts';
    const isWinner = winner === myTeam;

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
    this.effects.reset();
    this.updatePowerUpTimers();

    document.getElementById('gameOverScreen')?.remove();
    this.showWaitingRoom();

    if (this.isHost) {
      this.socket.emit('restart_game');
    }
  }

  private backToLobby(): void {
    this.gameState.gameStarted = false;
    this.gameState.gameOver = false;
    this.gameState.playerId = null;
    this.gameState.playerRole = null;
    this.isHost = false;
    this.gameState.players = {};
    this.effects.reset();
    this.updatePowerUpTimers();

    document.getElementById('gameOverScreen')?.remove();
    this.audio.stopBackgroundMusic();
    this.socket.emit('leave_game');
    this.showRoomSelection();
    this.requestRoomsList();

    const nameInput = document.getElementById('playerName') as HTMLInputElement | null;
    if (nameInput) {
      nameInput.value = '';
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
      showToast('Please enter a room code', 'error');
      return;
    }

    this.gameState.selectedRoom = roomCode;
    this.showJoinForm();
  }

  private showCreateRoomForm(): void {
    this.hideAllScreens();
    this.revealScreen('createRoomForm');
  }

  private showRoomSelection(): void {
    this.hideAllScreens();
    this.revealScreen('roomSelection');
  }

  private showJoinForm(): void {
    this.hideAllScreens();
    this.revealScreen('joinForm');
    // Focus the name field once the screen is on-screen (it's hidden at load, so
    // the HTML autofocus attribute wouldn't fire on reveal).
    const nameInput = document.getElementById('playerName') as HTMLInputElement | null;
    requestAnimationFrame(() => nameInput?.focus());
  }

  /** Show a screen with a replayed fade/slide entrance (display:block + animate-in). */
  private revealScreen(id: string): void {
    const el = document.getElementById(id);
    if (!el) {
      return;
    }
    el.style.display = 'block';
    el.classList.remove('animate-in');
    void el.offsetWidth; // force reflow so the animation restarts each time
    el.classList.add('animate-in');
  }

  private hideAllScreens(): void {
    const screens = ['roomSelection', 'createRoomForm', 'joinForm', 'waitingRoom', 'gameContainer'];
    screens.forEach(screenId => {
      const screen = document.getElementById(screenId);
      if (screen) {
        screen.style.display = 'none';
      }
    });
    // Leaving any screen exits the immersive full-bleed game layout.
    document.body.classList.remove('game-active', 'role-pacman', 'role-ghost');
  }

  private createRoom(): void {
    const roomNameInput = document.getElementById('newRoomName') as HTMLInputElement | null;
    const hostNameInput = document.getElementById('hostPlayerName') as HTMLInputElement | null;

    const roomName = roomNameInput?.value.trim();
    const hostName = hostNameInput?.value.trim();

    if (!roomName) {
      showToast('Please enter a room name', 'error');
      return;
    }

    if (!hostName) {
      showToast('Please enter your name', 'error');
      return;
    }

    if (!this.socket.connected) {
      showToast('Not connected to server. Please wait or refresh the page.', 'error');
      return;
    }

    this.socket.emit('create_room', { name: hostName, roomName, role: this.selectedRole });
  }

  public joinSpecificRoom(roomCode: string): void {
    this.gameState.selectedRoom = roomCode;
    this.showJoinForm();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PacManGame();
});
