import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = dirname(fileURLToPath(import.meta.url));

// The client lives in src/client; static assets (images/sounds) live in
// ./public and are copied verbatim into the build. The stylesheet is imported
// from main.ts so Vite + Tailwind process it. The production bundle is emitted
// to dist/client, which the Express server serves.
export default defineConfig({
  root: resolve(repoRoot, 'src/client'),
  publicDir: resolve(repoRoot, 'public'),
  plugins: [tailwindcss()],
  build: {
    outDir: resolve(repoRoot, 'dist/client'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // In dev the Vite server proxies Socket.IO traffic (incl. the WebSocket
    // upgrade) to the Express/Socket.IO server so the client can use a plain
    // same-origin `io()` call in both dev and production.
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
