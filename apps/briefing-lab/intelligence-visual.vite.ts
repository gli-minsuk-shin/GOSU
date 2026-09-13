import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve(import.meta.dirname, 'tools'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, '../../tmp/briefing-intelligence/visual-build'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'tools/intelligence-visual.html') },
  },
});
