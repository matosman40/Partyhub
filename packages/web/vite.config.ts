import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, l'API et Socket.IO sont relayés vers le serveur Node (port 8282).
const target = process.env.PARTYHUB_URL ?? 'http://localhost:8282';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': target,
      '/socket.io': { target, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
