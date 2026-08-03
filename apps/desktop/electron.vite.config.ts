import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ['@gosu/contracts'] })] },
  // A sandboxed preload can only require Electron's allowlisted built-ins.
  // Bundle runtime validators and their workspace-schema dependency so the
  // bridge does not disappear in packaged builds.
  preload: { plugins: [externalizeDepsPlugin({ exclude: ['zod', '@gosu/contracts'] })] },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()],
  },
});
