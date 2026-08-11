import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { ModelCatalogSchema, type ModelCatalog } from '@gosu/contracts';

import {
  HERMES_CONFIGURED_MODEL_ID,
  HERMES_PROVIDER_ID,
  type RefreshableHermesProjectChat,
} from './hermes-project-chat-adapter';
import type { ProjectChatCodex } from './project-chat-service';

export const CODEX_PROVIDER_ID = 'codex';
const PROJECT_CHAT_CATALOG_PROVIDER_ID = 'gosu-project-chat';

type ProviderId = typeof CODEX_PROVIDER_ID | typeof HERMES_PROVIDER_ID;

type RoutedThread = Readonly<{
  providerId: ProviderId;
}>;

function notificationThreadId(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const params = (value as { params?: unknown }).params;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  const threadId = (params as { threadId?: unknown }).threadId;
  return typeof threadId === 'string' ? threadId : null;
}

function mergedCatalog(codex: ModelCatalog, hermes: ModelCatalog | null): ModelCatalog {
  if (!hermes) return codex;
  const catalogVersion = createHash('sha256')
    .update(`${codex.catalogVersion}\n${hermes.catalogVersion}`)
    .digest('hex');
  return ModelCatalogSchema.parse({
    schemaVersion: 1,
    providerId: PROJECT_CHAT_CATALOG_PROVIDER_ID,
    catalogVersion,
    fetchedAt: new Date().toISOString(),
    models: [
      ...codex.models,
      ...hermes.models.map((model) => ({
        ...model,
        // Codex remains the Project Chat default. Hermes is always an explicit user selection.
        isDefault: false,
      })),
    ],
  });
}

/**
 * Routes only Project Chat traffic. Literature and Lecture continue to receive Codex directly.
 * Hermes is absent until the user explicitly connects the installed BYO runtime.
 */
export class ProjectChatProviderRouter extends EventEmitter implements ProjectChatCodex {
  private readonly threads = new Map<string, RoutedThread>();
  private hermesCatalog: ModelCatalog | null = null;
  private hermesConnected = false;
  private hermesLifecycleTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly codex: ProjectChatCodex,
    private readonly hermes: RefreshableHermesProjectChat,
  ) {
    super();
    this.forwardProviderEvents(CODEX_PROVIDER_ID, codex);
    this.forwardProviderEvents(HERMES_PROVIDER_ID, hermes);
  }

  isHermesConnected() {
    return this.hermesConnected;
  }

  connectHermes() {
    return this.runHermesLifecycle(async () => {
      // A fresh sealed runtime check must pass before the provider becomes selectable. A failed
      // reconnect leaves the previous connected state unchanged instead of publishing stale data.
      const { catalog, collaborationModes } = await this.hermes.refreshConnectionCatalogs();
      const configuredModel = catalog.models.find(
        (model) => model.modelId === HERMES_CONFIGURED_MODEL_ID,
      );
      if (!configuredModel || configuredModel.providerId !== HERMES_PROVIDER_ID) {
        throw new Error('hermes_configured_model_missing');
      }
      this.hermesCatalog = catalog;
      this.hermesConnected = true;
      return { catalog, collaborationModes };
    });
  }

  disconnectHermes() {
    return this.runHermesLifecycle(async () => {
      const threadIds = [...this.threads]
        .filter(([, route]) => route.providerId === HERMES_PROVIDER_ID)
        .map(([threadId]) => threadId);
      this.hermesConnected = false;
      this.hermesCatalog = null;
      for (const threadId of threadIds) this.threads.delete(threadId);
      this.emit('disconnected', { providerId: HERMES_PROVIDER_ID });
      const releases = await Promise.allSettled(
        threadIds.map((threadId) => this.hermes.releaseThread(threadId)),
      );
      if (releases.some((release) => release.status === 'rejected')) {
        throw new Error('hermes_disconnect_incomplete');
      }
    });
  }

  async listModelCatalog() {
    const codexCatalog = await this.codex.listModelCatalog();
    return mergedCatalog(codexCatalog, this.hermesConnected ? this.hermesCatalog : null);
  }

  /** Branch-title generation stays on Codex even while the user is chatting through Hermes. */
  listBranchTitleModelCatalog() {
    return this.codex.listModelCatalog();
  }

  listCollaborationModeCatalog(modelId?: string | null) {
    if (modelId === HERMES_CONFIGURED_MODEL_ID) {
      this.requireHermesConnected();
      return this.hermes.listCollaborationModeCatalog();
    }
    return this.codex.listCollaborationModeCatalog();
  }

  async startThread(input: Parameters<ProjectChatCodex['startThread']>[0]) {
    const providerId = this.providerForModel(input.modelId);
    const provider = this.provider(providerId);
    const started = await provider.startThread(input);
    this.assertThreadPrefix(providerId, started.threadId);
    if (this.threads.has(started.threadId)) throw new Error('project_chat_thread_id_collision');
    this.threads.set(started.threadId, { providerId });
    return { threadId: started.threadId, providerId };
  }

  async runTurn(input: Parameters<ProjectChatCodex['runTurn']>[0]) {
    const providerId = this.threadProvider(input.threadId);
    const requestedProviderId = this.providerForModel(input.requestedModelId);
    if (providerId !== requestedProviderId) {
      throw new Error('project_chat_thread_provider_mismatch');
    }
    return this.provider(providerId).runTurn(input);
  }

  interruptTurn(threadId: string, turnId: string) {
    return this.provider(this.threadProvider(threadId)).interruptTurn(threadId, turnId);
  }

  revokeDynamicTools(threadId: string) {
    this.provider(this.threadProvider(threadId)).revokeDynamicTools(threadId);
  }

  async releaseThread(threadId: string) {
    const route = this.threads.get(threadId);
    if (!route) return;
    this.threads.delete(threadId);
    await this.provider(route.providerId).releaseThread(threadId);
  }

  private providerForModel(modelId: string | null): ProviderId {
    if (modelId === HERMES_CONFIGURED_MODEL_ID) {
      this.requireHermesConnected();
      return HERMES_PROVIDER_ID;
    }
    return CODEX_PROVIDER_ID;
  }

  private provider(providerId: ProviderId): ProjectChatCodex {
    return providerId === HERMES_PROVIDER_ID ? this.hermes : this.codex;
  }

  private threadProvider(threadId: string): ProviderId {
    const route = this.threads.get(threadId);
    if (!route) throw new Error('project_chat_thread_not_found');
    if (route.providerId === HERMES_PROVIDER_ID) this.requireHermesConnected();
    return route.providerId;
  }

  private requireHermesConnected() {
    if (!this.hermesConnected || !this.hermesCatalog) {
      throw new Error('hermes_not_connected');
    }
  }

  private runHermesLifecycle<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.hermesLifecycleTail.then(operation, operation);
    this.hermesLifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertThreadPrefix(providerId: ProviderId, threadId: string) {
    const hermesPrefix = threadId.startsWith('hermes:');
    if (
      (providerId === HERMES_PROVIDER_ID && !hermesPrefix) ||
      (providerId === CODEX_PROVIDER_ID && hermesPrefix)
    ) {
      throw new Error('project_chat_provider_thread_prefix_invalid');
    }
  }

  private forwardProviderEvents(providerId: ProviderId, provider: ProjectChatCodex) {
    provider.on('notification', (notification: unknown) => {
      const threadId = notificationThreadId(notification);
      if (!threadId || this.threads.get(threadId)?.providerId !== providerId) return;
      this.emit('notification', notification);
    });
    provider.on(
      'invocation',
      (event: { threadId?: string; turnId?: string; invocation?: unknown }) => {
        if (!event.threadId || this.threads.get(event.threadId)?.providerId !== providerId) return;
        this.emit('invocation', event);
      },
    );
    provider.on('disconnected', () => {
      for (const [threadId, route] of this.threads) {
        if (route.providerId === providerId) this.threads.delete(threadId);
      }
      if (providerId === HERMES_PROVIDER_ID) {
        this.hermesConnected = false;
        this.hermesCatalog = null;
      }
      this.emit('disconnected', { providerId });
    });
  }
}

export type HermesProjectChatConnection = Pick<
  ProjectChatProviderRouter,
  'connectHermes' | 'disconnectHermes' | 'isHermesConnected'
>;
