import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve(import.meta.dirname, 'tools'),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4319, strictPort: true },
  build: {
    outDir: resolve(import.meta.dirname, '../../tmp/briefing-workspace-visual'),
    rollupOptions: {
      input: [
        resolve(import.meta.dirname, 'tools/project-context-visual.html'),
        resolve(import.meta.dirname, 'tools/chat-controls-visual.html'),
        resolve(import.meta.dirname, 'tools/workspace-visual.html'),
        resolve(import.meta.dirname, 'tools/global-assistant-visual.html'),
        resolve(import.meta.dirname, 'tools/provider-connections-visual.html'),
        resolve(import.meta.dirname, 'tools/weather-probability-visual.html'),
        resolve(import.meta.dirname, 'tools/paper-retention-visual.html'),
      ],
    },
  },
});
