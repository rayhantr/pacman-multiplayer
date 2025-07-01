# Modern Multiplayer Pac-Man

A modern, real-time multiplayer Pac-Man game built with TypeScript, Socket.IO, and Express.js. This project has been fully modernized with the latest tools and best practices for 2024/2025.

## 🚀 Features

- **Real-time multiplayer**: Up to 5 players (1 Pac-Man + 4 ghosts)
- **Modern TypeScript**: Full type safety with strict configuration
- **Socket.IO**: Real-time WebSocket communication
- **Power-ups**: Speed boost, invincibility, and score multiplier
- **Responsive design**: Modern HTML5 Canvas rendering
- **Development tools**: Hot reload, linting, formatting, and testing

## 🛠️ Tech Stack

### Core Technologies

- **Node.js** 20+ - Runtime environment
- **TypeScript** 5.7+ - Type-safe JavaScript
- **Express.js** 5.1+ - Web framework
- **Socket.IO** 4.8+ - Real-time communication
- **HTML5 Canvas** - Game rendering

### Development Tools

- **ESLint** 9.15+ - Linting with flat config
- **Prettier** 3.4+ - Code formatting
- **Vitest** 2.1+ - Modern testing framework
- **tsx** - Fast TypeScript execution
- **Husky** - Git hooks
- **lint-staged** - Pre-commit code quality

## 📦 Installation

```bash
# Clone the repository
git clone <repository-url>
cd pacman-typescript

# Install dependencies
npm install

# Start development server
npm run dev
```

## 🎮 Game Controls

- **Arrow Keys**: Move your character
- **First player**: Becomes Pac-Man
- **Other players**: Become ghosts

## 🎯 Game Rules

### Pac-Man

- Collect all pellets to win
- Avoid ghosts (unless you have invincibility power-up)
- Collect power-ups for special abilities

### Ghosts

- Catch Pac-Man to win
- Work together to corner Pac-Man
- Avoid Pac-Man when they have invincibility

### Power-ups (spawn every 30 seconds)

- **Speed Boost** (🟢): Increased movement speed for 10 seconds
- **Invincibility** (🟣): Immunity to ghosts for 5 seconds
- **Score Multiplier** (🔵): Double points for pellets

## 📜 Available Scripts

### Development

```bash
npm run dev          # Start development server with hot reload
npm run dev:server   # Start only server with hot reload
npm run dev:client   # Build client code in watch mode
```

### Building

```bash
npm run build        # Build both server and client
npm run build:server # Build only server
npm run build:client # Build only client
npm run clean        # Clean build directory
```

### Code Quality

```bash
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint issues automatically
npm run format       # Format code with Prettier
npm run format:check # Check code formatting
npm run type-check   # Run TypeScript type checking
npm run quality      # Run all quality checks
```

### Testing

```bash
npm run test         # Run tests in watch mode
npm run test:watch   # Run tests in watch mode (alias)
npm run test:coverage # Run tests with coverage report
```

### Production

```bash
npm start           # Start production server
```

## 🏗️ Project Structure

```
pacman-typescript/
├── src/
│   ├── client/           # Client-side TypeScript code
│   │   └── js/
│   │       └── game.ts   # Main game client logic
│   └── server/           # Server-side TypeScript code
│       ├── index.ts      # Express server setup
│       ├── gameManager.ts # Game logic and state management
│       ├── types.ts      # Shared type definitions
│       └── *.test.ts     # Test files
├── public/               # Static assets
│   ├── index.html        # Main HTML file
│   ├── css/              # Stylesheets
│   ├── images/           # Game sprites
│   ├── sounds/           # Audio files
│   └── js/               # Compiled client JavaScript
├── dist/                 # Compiled server code
└── config files          # TypeScript, ESLint, Prettier, etc.
```

## 🔧 Modernization Updates

This project has been fully modernized with the latest 2024/2025 best practices:

### TypeScript Improvements

- **ES2023 target** for latest JavaScript features
- **Strict type checking** with comprehensive rules
- **Modern module resolution** using bundler mode
- **Readonly types** and immutable patterns
- **Type-only imports** for better tree-shaking

### ESLint Configuration

- **Flat config format** (modern ESLint 9+)
- **TypeScript-aware rules** with proper type checking
- **Prettier integration** for consistent formatting
- **Environment-specific rules** (client vs server)

### Build and Development

- **tsx** for fast TypeScript execution (replaces ts-node)
- **Vitest** for modern testing (replaces Jest)
- **Concurrent development** with live reload
- **Modern package.json** with proper engine constraints

### Code Quality

- **Husky** git hooks for pre-commit checks
- **lint-staged** for efficient pre-commit linting
- **Comprehensive type safety** with strict TypeScript
- **Modern error handling** and logging

### Dependencies

- **Latest versions** of all packages
- **Security improvements** with proper CORS and headers
- **Performance optimizations** with ES modules
- **Modern Socket.IO** with proper typing

## 🌐 Browser Support

- Modern browsers with ES2023 support
- WebSocket support required
- HTML5 Canvas support required

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run quality checks: `npm run quality`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

## 📝 License

This project is licensed under the ISC License.

## 🎉 Acknowledgments

- Built with modern TypeScript and Node.js
- Socket.IO for real-time multiplayer functionality
- Express.js for robust server framework
- HTML5 Canvas for smooth game rendering
