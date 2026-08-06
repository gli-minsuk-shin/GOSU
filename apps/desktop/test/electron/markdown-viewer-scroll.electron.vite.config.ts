import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const testRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/markdown-viewer-scroll-smoke',
      rollupOptions: {
        input: resolve(testRoot, 'markdown-viewer-scroll-smoke.ts'),
        output: {
          entryFileNames: 'main.cjs',
          format: 'cjs',
        },
      },
    },
  },
});
