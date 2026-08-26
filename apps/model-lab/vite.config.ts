import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { createModelCopilotPlugin } from './model-copilot-server';

export default defineConfig({
  plugins: [react(), createModelCopilotPlugin()],
  server: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true,
  },
});
