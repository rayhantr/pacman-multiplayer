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
    players: {
        [id: string]: ClientPlayer;
    };
    maze: number[][];
    pellets: Set<string>;
    powerUps: {
        [key: string]: any;
    };
    score: number;
    pelletsRemaining: number;
    gameStarted: boolean;
    gameOver: boolean;
    playerId: string | null;
    playerRole: string | null;
}
declare class PacManGame {
    private socket;
    private canvas;
    private ctx;
    private gameState;
    private readonly CELL_SIZE;
    private readonly MAZE_WIDTH;
    private readonly MAZE_HEIGHT;
    private animationFrame;
    private readonly COLORS;
    constructor();
    private initializeCanvas;
    private initializeGameState;
    private connectToServer;
    private setupSocketEvents;
    private setupEventListeners;
    private startGameLoop;
    private render;
    private drawMaze;
    private drawPellets;
    private drawPowerUps;
    private drawPlayers;
    joinGame(): void;
    startGame(): void;
    private updateGameState;
    private showWaitingRoom;
    private showGameCanvas;
    private updatePlayersDisplay;
    private updateStartButton;
    private updateGameInfo;
    private updateConnectionStatus;
    private showGameOverScreen;
    private playBackgroundMusic;
    private stopBackgroundMusic;
    private playPowerUpSound;
}
//# sourceMappingURL=game.d.ts.map