import { randomBytes } from 'node:crypto';
import type { ProjectBridge } from './briefing-project-bridge';
import type { ProjectChatAttachmentService } from '../desktop/src/main/project-chat-attachment-service';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { routineModels, runRoutineWithGosuLanguage } from './briefing-native';
import { RoutineRequestSchema, routineErrorMessage } from './src/routine-builder';
import { LiveSourceService } from './live-source-service';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { briefingClientContext } from './briefing-client-context';
import { ASSISTANT_TURN_TIMEOUT_MS } from './briefing-tool-policy';
import { SharedPaperSummaryLibrary } from './paper-summary-library';
import { classifySavedPaperTexts } from './paper-classification';
import type { TodoReader } from './src/briefing-todos';
import type { BriefingTaskActions } from './src/briefing-task-actions';
import { defaultModelRouting, type ModelRouting } from '@gosu/contracts';
import { BriefingGuidanceStore } from './briefing-guidance-store';

function productionSources(
  consent?: (message: string, signal: AbortSignal) => Promise<void>,
  reuseApprovedScopes?: () => boolean,
) {
  const service = new LiveSourceService(
    undefined,
    undefined,
    consent,
    undefined,
    undefined,
    new BriefingWorkspaceStore(undefined, undefined, reuseApprovedScopes),
  );
  service.sharedPaperLibrary = new SharedPaperSummaryLibrary(undefined, undefined, undefined, () =>
    service.modelRouting ? service.modelRouting() : Promise.resolve(defaultModelRouting()),
  );
  service.paperClassifier = classifySavedPaperTexts;
  service.quickBriefingRunner = runRoutineWithGosuLanguage;
  service.guidance = new BriefingGuidanceStore();
  service.enableGeneration(undefined, false);
  return service;
}

const BASE = '/api/briefing-agent';
export function trustedRoutineRequest(request: IncomingMessage) {
  const host = request.headers.host;
  if (!host || !/^(?:127\.0\.0\.1|localhost):4318$/.test(host)) return false;
  const origin = request.headers.origin;
  const site = request.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;
  return origin ? origin === `http://${host}` : site === 'same-origin';
}

export function createBriefingMiddleware(
  deps = { models: routineModels, run: runRoutineWithGosuLanguage },
  sourceService?: LiveSourceService,
  todoReader?: TodoReader,
  modelRouting?: () => Promise<ModelRouting>,
  consent?: (message: string, signal: AbortSignal) => Promise<void>,
  projectBridge?: ProjectBridge,
  attachments?: ProjectChatAttachmentService,
  reuseApprovedScopes?: () => boolean,
  taskActions?: BriefingTaskActions,
) {
  const sources = sourceService ?? productionSources(consent, reuseApprovedScopes);
  if (todoReader) sources.todoReader = todoReader;
  if (taskActions) sources.taskActions = taskActions;
  if (modelRouting) sources.modelRouting = modelRouting;
  if (projectBridge) sources.projectBridge = projectBridge;
  if (attachments) sources.setAttachments(attachments);
  const capability = randomBytes(32).toString('hex');
  const controllers = new Set<AbortController>();
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith(BASE)) return next();
    if (!trustedRoutineRequest(req)) return json(res, 403, { error: 'routine_origin_denied' });
    const supplied = req.headers['x-gosu-client-token'];
    const clientToken =
      typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied)
        ? supplied
        : randomBytes(32).toString('hex');
    if (req.url === `${BASE}/session` && req.method === 'GET')
      return json(res, 200, { token: capability, clientToken });
    if (req.headers['x-gosu-routine-token'] !== capability)
      return json(res, 403, { error: 'routine_token_denied' });
    if (controllers.size >= 3) return json(res, 429, { error: 'routine_busy' });
    const controller = new AbortController();
    controllers.add(controller);
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', disconnect);
    const requestTimer = setTimeout(
      () => controller.abort(),
      req.method === 'POST' &&
        (req.url === `${BASE}/sources/assistant/chat` ||
          req.url === `${BASE}/sources/papers/shared/save`)
        ? ASSISTANT_TURN_TIMEOUT_MS + 15_000
        : 200_000,
    );
    try {
      if (req.url?.startsWith(`${BASE}/sources/`)) {
        await briefingClientContext.run(clientToken, () =>
          sources.handle(req, res, controller.signal),
        );
        return;
      }
      if (req.url === `${BASE}/models` && req.method === 'GET') {
        const result = await deps.models();
        if (!controller.signal.aborted) json(res, 200, { providers: result });
        return;
      }
      if (req.url !== BASE || req.method !== 'POST')
        return json(res, 404, { error: 'routine_route_unknown' });
      if (!req.headers['content-type']?.startsWith('application/json'))
        return json(res, 415, { error: 'routine_content_type' });
      if (Number(req.headers['content-length'] ?? 0) > 128_000)
        return json(res, 413, { error: 'routine_request_limit' });
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk as Uint8Array);
        bytes += buffer.length;
        if (bytes > 128_000) {
          json(res, 413, { error: 'routine_request_limit' });
          return;
        }
        chunks.push(buffer);
      }
      let input: ReturnType<typeof RoutineRequestSchema.parse>;
      try {
        input = RoutineRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        return json(res, 400, { error: 'routine_request_invalid' });
      }
      if (controller.signal.aborted) return;
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.flushHeaders();
      const send = (value: unknown) => {
        if (!res.destroyed && !controller.signal.aborted) res.write(`${JSON.stringify(value)}\n`);
      };
      const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15_000);
      try {
        const result = await deps.run(input, controller.signal, (progress) =>
          send({ type: 'progress', progress }),
        );
        send({ type: 'result', result });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'routine_failed';
        send({ type: 'error', message: routineErrorMessage(code) });
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
    } catch {
      if (!res.headersSent && !res.destroyed) json(res, 500, { error: 'routine_unavailable' });
      else res.end();
    } finally {
      clearTimeout(requestTimer);
      controllers.delete(controller);
      res.off('close', disconnect);
    }
  };
  return {
    middleware,
    desktopConfiguration: () => sources.desktopConfiguration(),
    hostReads: sources.hostReads(),
    notificationSnapshot: () => sources.notificationSnapshot(),
    startScheduling: () => sources.generation?.startTimer(),
    close: () => {
      sources.close();
      for (const controller of controllers) controller.abort();
    },
  };
}

export function briefingAgentPlugin(): Plugin {
  const service = createBriefingMiddleware();
  return {
    name: 'gosu-briefing-native-agent',
    configureServer(server) {
      server.middlewares.use(service.middleware);
      if (server.httpServer?.listening) service.startScheduling();
      else server.httpServer?.once('listening', service.startScheduling);
      server.httpServer?.once('close', service.close);
    },
    configurePreviewServer(server) {
      server.middlewares.use(service.middleware);
      if (server.httpServer.listening) service.startScheduling();
      else server.httpServer.once('listening', service.startScheduling);
      server.httpServer.once('close', service.close);
    },
  };
}
