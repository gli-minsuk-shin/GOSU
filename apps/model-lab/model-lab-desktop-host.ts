import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { modelLabBackendContext } from './model-lab-backend-context';
import { migrateProjectModelSeeds } from './src/project-model-workspace';
import { ProjectModelTransferStore } from './project-model-transfer-store';
import { PROJECT_MODEL_COPY_PATH } from './src/project-model-transfer';
import { createModelLabReader } from './model-reference-reader';
import { ModelChatContextStore } from './model-chat-context';
import type { ModelLabReadInput } from './model-reference-contracts';

export type ModelLabMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => Promise<void>;
const projectPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const storageKeyPattern = /^gosu\.model-lab\.[a-z0-9.-]{1,90}$/;
const maxStateBytes = 24 * 1024 * 1024;
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Private loopback host owned by GOSU; every capability belongs to one project. */
export class ModelLabDesktopHost {
  private readonly grants = new Map<string, string>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly copies: ProjectModelTransferStore;
  private readonly server = createServer((request, response) => {
    void this.respond(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end('Model Lab request failed');
    });
  });
  origin = '';
  constructor(
    private readonly options: {
      assetsDirectory: string;
      stateDirectory: string;
      resolveProject: (projectId: string) => Promise<{ id: string; name: string } | null>;
      listProjects?: () => Promise<readonly { id: string; name: string }[]>;
      middleware: ModelLabMiddleware;
    },
  ) {
    this.copies = new ProjectModelTransferStore({
      root: options.stateDirectory,
      readStorage: (id) => this.storage(id),
      resolveProject: options.resolveProject,
      listProjects: options.listProjects ?? (async () => []),
    });
  }

  async start() {
    if (this.origin) return;
    await readFile(join(this.options.assetsDirectory, 'index.html'), 'utf8');
    await new Promise<void>((resolveReady, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolveReady();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('model_lab_host_unavailable');
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async open(projectId: string) {
    if (!projectPattern.test(projectId)) throw new Error('invalid_model_lab_project');
    const project = await this.options.resolveProject(projectId);
    if (!project || project.id !== projectId) throw new Error('model_lab_project_unavailable');
    await this.start();
    let token = this.grants.get(projectId);
    if (!token) {
      token = randomBytes(32).toString('hex');
      this.grants.set(projectId, token);
    }
    return { projectId, url: `${this.origin}/s/${token}/${projectId}/` };
  }

  async close() {
    this.grants.clear();
    this.server.closeAllConnections();
    await new Promise<void>((done) => this.server.close(() => done()));
    await Promise.allSettled(this.writes.values());
    this.origin = '';
  }

  async readForChat(projectId: string, input: ModelLabReadInput) {
    return createModelLabReader({
      storage: async (id) => {
        await this.writes.get(id)?.catch(() => undefined);
        return this.readStorage(id);
      },
      activeProject: async (id) => Boolean(await this.options.resolveProject(id)),
      archive: (id) => new ModelChatContextStore(join(this.directory(id), 'chat-context')),
    })(projectId, input);
  }

  private directory(projectId: string) {
    return join(this.options.stateDirectory, projectId);
  }
  private async storage(projectId: string): Promise<Record<string, string>> {
    await this.writes.get(projectId)?.catch(() => undefined);
    const value = await this.readStorage(projectId);
    if (migrateProjectModelSeeds(value).storage === value) return value;
    return this.mutateStorage(projectId, (current) => migrateProjectModelSeeds(current).storage);
  }
  private async readStorage(projectId: string): Promise<Record<string, string>> {
    try {
      const text = await readFile(join(this.directory(projectId), 'workspace.json'), 'utf8');
      if (Buffer.byteLength(text) > maxStateBytes) throw new Error('model_lab_workspace_too_large');
      const value: unknown = JSON.parse(text);
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.entries(value).some(
          ([key, item]) => !storageKeyPattern.test(key) || typeof item !== 'string',
        )
      )
        throw new Error('invalid_model_lab_workspace');
      return value as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  private async save(projectId: string, key: string, value: string | null) {
    await this.mutateStorage(projectId, (state) => {
      const next = { ...state };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }
  private async mutateStorage(
    projectId: string,
    mutate: (state: Record<string, string>) => Record<string, string>,
  ) {
    const previous = this.writes.get(projectId) ?? Promise.resolve();
    let result: Record<string, string> = {};
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        const directory = this.directory(projectId);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const state = await this.readStorage(projectId);
        result = mutate(state);
        if (result === state) return;
        const text = JSON.stringify(result);
        if (Buffer.byteLength(text) > maxStateBytes)
          throw new Error('model_lab_workspace_too_large');
        const temporary = join(directory, `workspace-${randomUUID()}.tmp`);
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, join(directory, 'workspace.json'));
      });
    this.writes.set(projectId, task);
    await task;
    return result;
  }

  private async respond(request: IncomingMessage, response: ServerResponse) {
    const deny = (status: number, message: string) => {
      response.writeHead(status);
      response.end(message);
    };
    if (
      request.headers.host !== new URL(this.origin).host ||
      (request.headers.origin && request.headers.origin !== this.origin)
    )
      return deny(403, 'Forbidden');
    const match = /^\/s\/([a-f0-9]{64})\/([a-f0-9-]{36})\/(.*)$/.exec(request.url ?? '');
    if (!match || !projectPattern.test(match[2]!) || this.grants.get(match[2]!) !== match[1])
      return deny(403, 'Forbidden');
    const projectId = match[2]!;
    const project = await this.options.resolveProject(projectId);
    if (!project) return deny(404, 'Project unavailable');
    const route = match[3]!;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    );
    if (`/${route}`.startsWith(PROJECT_MODEL_COPY_PATH)) {
      response.setHeader('Content-Type', 'application/json');
      try {
        const path = `/${route}`;
        if (path === `${PROJECT_MODEL_COPY_PATH}/targets` && request.method === 'GET') {
          response.end(JSON.stringify({ projects: await this.copies.targets(projectId) }));
          return;
        }
        if (path === PROJECT_MODEL_COPY_PATH && request.method === 'GET') {
          response.end(JSON.stringify({ copies: await this.copies.pending(projectId) }));
          return;
        }
        if (
          request.method !== 'POST' ||
          ![PROJECT_MODEL_COPY_PATH, `${PROJECT_MODEL_COPY_PATH}/ack`].includes(path)
        )
          return deny(405, 'Method not allowed');
        request.setEncoding('utf8');
        let body = '';
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 16_384) return deny(413, 'Request too large');
        }
        const input: unknown = JSON.parse(body);
        if (path.endsWith('/ack')) {
          if (
            !input ||
            typeof input !== 'object' ||
            !('id' in input) ||
            typeof input.id !== 'string'
          )
            throw new Error('Invalid copy receipt');
          await this.copies.acknowledge(projectId, input.id);
          response.end(JSON.stringify({ ok: true }));
          return;
        }
        const { entries: _entries, ...copy } = await this.copies.create(projectId, input);
        response.end(JSON.stringify({ copy }));
        return;
      } catch (error) {
        response.statusCode = 400;
        response.end(
          JSON.stringify({ error: error instanceof Error ? error.message : 'Model copy failed' }),
        );
        return;
      }
    }
    if (route === 'api/model-lab-storage' && request.method === 'PUT') {
      request.setEncoding('utf8');
      let body = '';
      let size = 0;
      for await (const chunk of request) {
        size += Buffer.byteLength(chunk);
        if (size > maxStateBytes) return deny(413, 'Workspace too large');
        body += chunk.toString();
      }
      let input: unknown;
      try {
        input = JSON.parse(body);
      } catch {
        return deny(400, 'Invalid storage update');
      }
      if (
        !input ||
        typeof input !== 'object' ||
        !('key' in input) ||
        !('value' in input) ||
        typeof input.key !== 'string' ||
        !storageKeyPattern.test(input.key) ||
        (input.value !== null && typeof input.value !== 'string')
      )
        return deny(400, 'Invalid storage update');
      await this.save(projectId, input.key, input.value);
      response.writeHead(204);
      response.end();
      return;
    }
    if (route.startsWith('api/')) {
      request.url = `/${route}`;
      await modelLabBackendContext.run({ projectId, directory: this.directory(projectId) }, () =>
        this.options.middleware(request, response, () => deny(404, 'Not found')),
      );
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return deny(405, 'Method not allowed');
    const pathname = decodeURIComponent(route.split('?')[0] || 'index.html');
    const root = resolve(this.options.assetsDirectory);
    const filePath = resolve(root, pathname);
    if (!filePath.startsWith(`${root}${sep}`) || pathname.includes('\\'))
      return deny(403, 'Forbidden');
    let bytes: Buffer;
    try {
      bytes = await readFile(filePath);
    } catch {
      return deny(404, 'Not found');
    }
    if (pathname === 'index.html') {
      const host = {
        projectId,
        projectName: project.name,
        basePath: `/s/${match[1]}/${projectId}/`,
        storage: await this.storage(projectId),
      };
      const bootstrap = JSON.stringify(host).replaceAll('<', '\\u003c');
      bytes = Buffer.from(
        bytes
          .toString('utf8')
          .replace(
            '</head>',
            `<script type="application/json" id="gosu-model-lab-host">${bootstrap}</script></head>`,
          ),
      );
    }
    response.writeHead(200, {
      'Content-Type': mime[extname(pathname)] ?? 'application/octet-stream',
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  }
}
