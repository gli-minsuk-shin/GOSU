import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createBriefingMiddleware } from './briefing-server';
import type { TodoReader } from './src/briefing-todos';
import type { BriefingTaskActions } from './src/briefing-task-actions';
import type { ModelRouting } from '@gosu/contracts';
import type { ProjectBridge } from './briefing-project-bridge';
import type { ProjectChatAttachmentService } from '../desktop/src/main/project-chat-attachment-service';
/** One app-owned global host. A busy standalone port is never adopted or trusted. */
export class BriefingDesktopHost {
  private server: Server | undefined;
  private pending: Promise<void> | undefined;
  private service?: ReturnType<typeof createBriefingMiddleware>;
  origin = 'http://127.0.0.1:4318';
  constructor(
    private readonly assetsDirectory: string,
    private readonly port = 4318,
    private readonly serviceFactory = createBriefingMiddleware,
    private readonly todoReader?: TodoReader,
    private readonly modelRouting?: () => Promise<ModelRouting>,
    private readonly consent?: (message: string, signal: AbortSignal) => Promise<void>,
    private readonly projectBridge?: ProjectBridge,
    private readonly attachments?: ProjectChatAttachmentService,
    private readonly reuseApprovedScopes?: () => boolean,
    private readonly taskActions?: BriefingTaskActions,
  ) {}
  private async ensureStarted() {
    if (!this.server?.listening) {
      this.pending ??= this.start().finally(() => {
        this.pending = undefined;
      });
      await this.pending;
    }
  }
  async open() {
    await this.ensureStarted();
    return {
      url: `${this.origin}/?embedded=gosu`,
      configuration: await this.service!.desktopConfiguration(),
    };
  }
  async notifications() {
    await this.ensureStarted();
    return this.service!.notificationSnapshot();
  }
  /**
   * Calendar, mail, saved briefings and saved paper summaries for another part of the app, under
   * the settings approved in Briefing Lab. The in-process service starts on first use.
   */
  async reads() {
    await this.ensureStarted();
    return this.service!.hostReads;
  }
  private async start() {
    await readFile(resolve(this.assetsDirectory, 'index.html'));
    const service = this.serviceFactory(
      undefined,
      undefined,
      this.todoReader,
      this.modelRouting,
      this.consent,
      this.projectBridge,
      this.attachments,
      this.reuseApprovedScopes,
      this.taskActions,
    );
    const server = createServer((req, res) => {
      void (async () => {
        if (req.headers.host !== new URL(this.origin).host) {
          res.writeHead(403);
          res.end();
          return;
        }
        await service.middleware(req, res, () => {
          void (async () => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.writeHead(405);
              res.end();
              return;
            }
            const pathname = decodeURIComponent(new URL(req.url ?? '/', this.origin).pathname);
            const path = resolve(
              this.assetsDirectory,
              pathname === '/' ? 'index.html' : '.' + pathname,
            );
            if (!path.startsWith(resolve(this.assetsDirectory) + sep)) {
              res.writeHead(403);
              res.end();
              return;
            }
            const mime: Record<string, string> = {
              '.html': 'text/html; charset=utf-8',
              '.js': 'text/javascript; charset=utf-8',
              '.css': 'text/css',
              '.woff2': 'font/woff2',
              '.woff': 'font/woff',
              '.ttf': 'font/ttf',
              '.svg': 'image/svg+xml',
              '.png': 'image/png',
            };
            if (!mime[extname(path)]) {
              res.writeHead(404);
              res.end();
              return;
            }
            const data = await readFile(path);
            res.writeHead(200, {
              'Content-Type': mime[extname(path)]!,
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy':
                'frame-ancestors file: http://127.0.0.1:* http://localhost:*',
            });
            res.end(req.method === 'HEAD' ? undefined : data);
          })().catch(() => {
            if (!res.headersSent) res.writeHead(404);
            res.end();
          });
        });
      })().catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    try {
      await new Promise<void>((ready, reject) => {
        server.once('error', reject);
        server.listen(this.port, '127.0.0.1', () => {
          server.off('error', reject);
          ready();
        });
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('briefing_host_unavailable');
      this.origin = `http://127.0.0.1:${address.port}`;
      this.server = server;
      this.service = service;
      service.startScheduling();
    } catch (error) {
      service.close();
      server.close();
      throw error;
    }
  }
  async close() {
    this.service?.close();
    this.server?.closeAllConnections();
    await new Promise<void>((done) => (this.server ? this.server.close(() => done()) : done()));
    this.server = undefined;
  }
}
