import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const testRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@gosu/contracts'] })],
    build: {
      outDir: 'out/local-database-smoke',
      rollupOptions: {
        input: resolve(testRoot, 'local-database-smoke.ts'),
        output: {
          entryFileNames: 'main.cjs',
          format: 'cjs',
        },
      },
    },
  },
});
