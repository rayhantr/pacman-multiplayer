# Multiplayer Pac-Man

A real-time multiplayer Pac-Man game built with TypeScript, an authoritative
Node/Express + Socket.IO server, and an HTML5 Canvas client bundled with Vite.

One player controls Pac-Man; up to four others play as ghosts. The server owns
the game state and broadcasts it to all clients over WebSockets.

## ✨ Features

- **Real-time multiplayer** — up to 5 players per room (1 Pac-Man + 4 ghosts)
- **Lobby with a live room list** — create/join rooms; the list updates as rooms
  change
- **Working power-ups** — Speed Boost, Invincibility, and Pellet Multiplier, each
  applied and expired authoritatively on the server
- **Authoritative server** — movement, scoring, collisions, and win/lose are
  resolved server-side; clients render with smooth interpolation
- **Type-safe wire protocol** — the Socket.IO event contract is shared between
  client and server (`src/shared/types.ts`)

## 🛠️ Tech Stack

| Area     | Technology                                                                                  |
| -------- | ------------------------------------------------------------------------------------------- |
| Language | TypeScript 6                                                                                |
| Server   | Node.js 22+, Express 5, Socket.IO 4.8                                                       |
| Security | helmet (CSP + secure headers)                                                               |
| Client   | HTML5 Canvas, Vite 8, socket.io-client                                                      |
| Tooling  | ESLint 10 (flat config) + typescript-eslint, Prettier 3, Vitest 4, tsx, Husky + lint-staged |

## 📦 Installation

```bash
git clone <repository-url>
cd pacman-multiplayer
npm install
```

Requires **Node.js ≥ 22.12**.

## 🎮 Running the game

### Development

```bash
npm run dev
```

This starts two processes:

- the **Express/Socket.IO server** on `http://localhost:3000` (via `tsx --watch`)
- the **Vite dev server** on `http://localhost:5173`

Open **http://localhost:5173** in your browser. Vite proxies Socket.IO traffic
to the backend, so the client connects with a plain same-origin `io()` call.

### Production

```bash
npm run build   # tsc (server) -> dist/server, vite build (client) -> dist/client
npm start       # NODE_ENV=production node dist/server/index.js
```

In production the Express server serves the built client from `dist/client` and
handles Socket.IO on the same origin (default port `3000`, override with `PORT`).

## 🎯 How to play

- **Arrow keys** move your character.
- **First player to join a room** becomes Pac-Man and can start the game (needs at
  least 2 players); everyone else becomes a ghost.
- **Pac-Man** wins by collecting every pellet. **Ghosts** win by catching Pac-Man.

### Power-ups (spawn every 30s, collected by Pac-Man)

| Power-up             | Effect                                                             |
| -------------------- | ------------------------------------------------------------------ |
| 🟢 Speed Boost       | Shorter move cooldown for 10 seconds                               |
| 🟣 Invincibility     | For 5 seconds, walking into a ghost eats it (+200) and respawns it |
| 🔵 Pellet Multiplier | Pellets score double for 10 seconds                                |

## 📜 Scripts

| Command                           | Description                                  |
| --------------------------------- | -------------------------------------------- |
| `npm run dev`                     | Run server + Vite dev server with hot reload |
| `npm run build`                   | Build server and client for production       |
| `npm start`                       | Run the production server                    |
| `npm run preview`                 | Preview the production client build (Vite)   |
| `npm run lint` / `lint:fix`       | Lint with ESLint                             |
| `npm run format` / `format:check` | Format with Prettier                         |
| `npm run type-check`              | Type-check server and client (no emit)       |
| `npm run quality`                 | type-check + lint + format check             |
| `npm test` / `test:coverage`      | Run the Vitest suite                         |

## 🏗️ Project structure

```
pacman-multiplayer/
├── src/
│   ├── shared/
│   │   └── types.ts          # Shared domain + Socket.IO event contract
│   ├── server/
│   │   ├── index.ts          # Express + Socket.IO setup, helmet, CORS
│   │   ├── gameManager.ts     # Authoritative per-room game logic
│   │   ├── roomManager.ts     # Rooms / lobby
│   │   └── *.test.ts          # Vitest unit tests
│   └── client/
│       ├── index.html         # Vite entry
│       └── main.ts            # Canvas client (imports socket.io-client)
├── public/                   # Static assets (css, images, sounds) — Vite publicDir
├── dist/                     # Build output: dist/server + dist/client
├── vite.config.ts            # Client build + dev proxy
├── tsconfig.json             # Base TS config (extended by server/client)
├── tsconfig.server.json      # Server build (NodeNext, emits to dist)
└── tsconfig.client.json      # Client type-check (DOM libs, noEmit)
```

## 🔒 Security

- `helmet` sets a Content-Security-Policy and secure headers.
- CORS is locked to same-origin in production and to the Vite dev origin in
  development (never `*` with credentials).
- Room names are rendered with `textContent` (no HTML injection).

## 🌐 Browser support

Modern browsers with ES2023, WebSocket, and HTML5 Canvas support.

## 📝 License

ISC.
