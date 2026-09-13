import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { createModelCopilotPlugin } from './model-copilot-server';

export default defineConfig({
  base: './',
  build: { assetsInlineLimit: 0 },
  plugins: [react(), createModelCopilotPlugin()],
  server: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true,
  },
});
