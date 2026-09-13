import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
const testRoot = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(process.cwd(), 'out/notification-visual-smoke');
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: out,
      rollupOptions: {
        input: resolve(testRoot, 'notification-visual-smoke.ts'),
        output: { entryFileNames: 'main.cjs', format: 'cjs' },
      },
    },
  },
  renderer: {
    root: testRoot,
    base: './',
    plugins: [react()],
    build: {
      outDir: resolve(out, 'renderer'),
      emptyOutDir: false,
      assetsInlineLimit: 0,
      rollupOptions: { input: resolve(testRoot, 'notification-visual-smoke.html') },
    },
  },
});
