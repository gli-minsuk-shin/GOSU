import { resolve } from 'node:path';
import { cp, mkdir } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@gosu/contracts',
          '@gosu/integrations',
          '@gosu/model-lab-prototype',
          '@gosu/ui',
          '@gosu/ui/language',
          '@gosu/briefing-core',
        ],
      }),
      {
        name: 'bundle-model-lab',
        async closeBundle() {
          await mkdir(resolve('out/model-lab'), { recursive: true });
          await cp(resolve('../model-lab/dist'), resolve('out/model-lab'), { recursive: true });
          await mkdir(resolve('out/briefing-lab'), { recursive: true });
          await cp(resolve('../briefing-lab/dist'), resolve('out/briefing-lab'), {
            recursive: true,
          });
          await cp(
            resolve('../model-lab/python-architecture-analyzer.py'),
            resolve('out/main/python-architecture-analyzer.py'),
          );
        },
      },
    ],
  },
  // A sandboxed preload can only require Electron's allowlisted built-ins.
  // Bundle runtime validators and their workspace-schema dependency so the
  // bridge does not disappear in packaged builds.
  preload: { plugins: [externalizeDepsPlugin({ exclude: ['zod', '@gosu/contracts'] })] },
  renderer: {
    build: { assetsInlineLimit: 0 },
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()],
  },
});
