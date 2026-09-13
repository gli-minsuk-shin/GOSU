import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const testRoot = fileURLToPath(new URL('.', import.meta.url));
const outputRoot = resolve(process.cwd(), 'out/application-language-visual-smoke');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: outputRoot,
      rollupOptions: {
        input: resolve(testRoot, 'application-language-visual-smoke.ts'),
        output: { entryFileNames: 'main.cjs', format: 'cjs' },
      },
    },
  },
  renderer: {
    root: testRoot,
    base: './',
    plugins: [react()],
    build: {
      outDir: resolve(outputRoot, 'renderer'),
      emptyOutDir: false,
      assetsInlineLimit: 0,
      rollupOptions: { input: resolve(testRoot, 'application-language-visual-smoke.html') },
    },
  },
});
