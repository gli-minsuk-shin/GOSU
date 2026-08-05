import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const testRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/literature-scroll-smoke',
      rollupOptions: {
        input: resolve(testRoot, 'literature-scroll-smoke.ts'),
        output: {
          entryFileNames: 'main.cjs',
          format: 'cjs',
        },
      },
    },
  },
});
