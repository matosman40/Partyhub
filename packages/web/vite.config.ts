import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Version affichée dans le journal d'erreurs : celle du paquet web.
const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string })
  .version;

// En développement, l'API et Socket.IO sont relayés vers le serveur Node (port 8282).
const target = process.env.PARTYHUB_URL ?? 'http://localhost:8282';

// Service worker du mode hors ligne : son numéro de version change à chaque build, donc le navigateur
// installe la nouvelle version et purge les caches de la précédente.
const serviceWorker: Plugin = {
  name: 'partyhub-service-worker',
  apply: 'build',
  generateBundle() {
    const version = `${appVersion}-${Date.now().toString(36)}`;
    const source = readFileSync(new URL('./sw/service-worker.js', import.meta.url), 'utf8').replaceAll(
      '__SW_VERSION__',
      version,
    );
    this.emitFile({ type: 'asset', fileName: 'sw.js', source });
  },
};

export default defineConfig({
  plugins: [react(), serviceWorker],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
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
