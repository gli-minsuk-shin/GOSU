import { resolve } from 'node:path';
import { cp } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { replaceLabBundle } from '../../scripts/lab-bundles.mjs';

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
          await replaceLabBundle(resolve('../model-lab/dist'), resolve('out/model-lab'));
          await replaceLabBundle(resolve('../briefing-lab/dist'), resolve('out/briefing-lab'));
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
