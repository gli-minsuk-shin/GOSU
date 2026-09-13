import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, '../../../tmp/mail-actions-visual'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'mail-actions-visual.html') },
  },
});
