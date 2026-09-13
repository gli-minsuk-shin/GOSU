import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { briefingAgentPlugin } from './briefing-server';

export default defineConfig({
  base: './',
  build: { assetsInlineLimit: 0 },
  plugins: [react(), briefingAgentPlugin()],
  server: { host: '127.0.0.1', port: 4318, strictPort: true, cors: false },
  preview: { host: '127.0.0.1', port: 4318, strictPort: true, cors: false },
});
