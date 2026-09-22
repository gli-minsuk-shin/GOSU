import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
const token = randomBytes(24).toString('hex');
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    react(),
    {
      name: 'private-graph-preview',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/__graph-qa/')) return next();
          if (
            req.method !== 'GET' ||
            req.url !== `/__graph-qa/${token}` ||
            req.headers.host !== '127.0.0.1:4396'
          ) {
            res.statusCode = 403;
            res.end();
            return;
          }
          try {
            const path = process.env.GOSU_GRAPH_PREVIEW_FILE;
            if (!path || (await stat(path)).size > 2_000_000) throw Error('missing');
            const value = JSON.parse(await readFile(path, 'utf8'));
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(value.model ?? value));
          } catch {
            res.statusCode = 503;
            res.end('Preview unavailable');
          }
        });
        console.info(`Graph preview: http://127.0.0.1:4396/graph-story-visual.html?key=${token}`);
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 4396,
    strictPort: true,
    headers: { 'Referrer-Policy': 'no-referrer' },
  },
});
