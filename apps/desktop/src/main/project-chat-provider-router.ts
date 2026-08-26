import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { ModelCatalogSchema, type ModelCatalog } from '@gosu/contracts';

import {
  CLAUDE_CODE_OPUS_MODEL_ID,
  CLAUDE_CODE_OPUS_5_MODEL_ID,
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_SONNET_MODEL_ID,
  type RefreshableClaudeCodeProjectChat,
} from './claude-code-project-chat-adapter';
import {
  HERMES_CONFIGURED_MODEL_ID,
  HERMES_PROVIDER_ID,
  type RefreshableHermesProjectChat,
} from './hermes-project-chat-adapter';
import type { ProjectChatCodex } from './project-chat-service';

export const CODEX_PROVIDER_ID = 'codex';
const PROJECT_CHAT_CATALOG_PROVIDER_ID = 'gosu-project-chat';

type ProviderId =
  typeof CODEX_PROVIDER_ID | typeof HERMES_PROVIDER_ID | typeof CLAUDE_CODE_PROVIDER_ID;

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

function mergedCatalog(
  codex: ModelCatalog,
  optionalCatalogs: readonly ModelCatalog[],
): ModelCatalog {
  if (optionalCatalogs.length === 0) return codex;
  const modelIds = new Set(codex.models.map((model) => model.modelId));
  for (const catalog of optionalCatalogs) {
    for (const model of catalog.models) {
      if (modelIds.has(model.modelId)) throw new Error('project_chat_model_id_collision');
      modelIds.add(model.modelId);
    }
  }
  const catalogVersion = createHash('sha256')
    .update(
      [codex.catalogVersion, ...optionalCatalogs.map((catalog) => catalog.catalogVersion)].join(
        '\n',
      ),
    )
    .digest('hex');
  return ModelCatalogSchema.parse({
    schemaVersion: 1,
    providerId: PROJECT_CHAT_CATALOG_PROVIDER_ID,
    catalogVersion,
    fetchedAt: new Date().toISOString(),
    models: [
      ...codex.models,
      ...optionalCatalogs.flatMap((catalog) =>
        catalog.models.map((model) => ({
          ...model,
          // Codex remains the Project Chat default. Local providers require explicit selection.
          isDefault: false,
        })),
      ),
    ],
  });
}

function emptyCodexCatalog(): ModelCatalog {
  return ModelCatalogSchema.parse({
    schemaVersion: 1,
    providerId: CODEX_PROVIDER_ID,
    catalogVersion: createHash('sha256').update('codex-unavailable').digest('hex'),
    fetchedAt: new Date().toISOString(),
    models: [],
  });
}

/**
 * Routes only Project Chat traffic. Literature and Lecture continue to receive Codex directly.
 * Optional local providers stay absent until the user explicitly connects a verified runtime.
 */
export class ProjectChatProviderRouter extends EventEmitter implements ProjectChatCodex {
  private readonly threads = new Map<string, RoutedThread>();
  private hermesCatalog: ModelCatalog | null = null;
  private hermesConnected = false;
  private hermesConnectionEpoch = 0;
  private hermesLifecycleTail: Promise<void> = Promise.resolve();
  private claudeCodeCatalog: ModelCatalog | null = null;
  private claudeCodeConnected = false;
  private claudeCodeConnectionEpoch = 0;
  private claudeCodeLifecycleTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly codex: ProjectChatCodex,
    private readonly hermes: RefreshableHermesProjectChat,
    private readonly claudeCode?: RefreshableClaudeCodeProjectChat,
  ) {
    super();
    this.forwardProviderEvents(CODEX_PROVIDER_ID, codex);
    this.forwardProviderEvents(HERMES_PROVIDER_ID, hermes);
    if (claudeCode) this.forwardProviderEvents(CLAUDE_CODE_PROVIDER_ID, claudeCode);
  }

  isHermesConnected() {
    return this.hermesConnected;
  }

  isClaudeCodeConnected() {
    return this.claudeCodeConnected;
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
        this.hermes.resetConnection();
        throw new Error('hermes_configured_model_missing');
      }
      try {
        // Renderer commands carry the opaque model ID. Refuse a provider/model collision before
        // publishing Hermes so that one ID can never be routed to two providers ambiguously.
        mergedCatalog(await this.codexCatalogOrEmpty(), [
          catalog,
          ...(this.claudeCodeConnected && this.claudeCodeCatalog ? [this.claudeCodeCatalog] : []),
        ]);
      } catch (error) {
        this.hermes.resetConnection();
        throw error;
      }
      this.hermesCatalog = catalog;
      this.hermesConnected = true;
      this.hermesConnectionEpoch += 1;
      return { catalog, collaborationModes };
    });
  }

  connectClaudeCode() {
    return this.runClaudeCodeLifecycle(async () => {
      if (!this.claudeCode) throw new Error('claude_code_provider_unavailable');
      const { catalog, collaborationModes } = await this.claudeCode.refreshConnectionCatalogs();
      if (
        catalog.providerId !== CLAUDE_CODE_PROVIDER_ID ||
        !catalog.models.some((model) => model.modelId === CLAUDE_CODE_SONNET_MODEL_ID) ||
        !catalog.models.some((model) => model.modelId === CLAUDE_CODE_OPUS_MODEL_ID) ||
        !catalog.models.some((model) => model.modelId === CLAUDE_CODE_OPUS_5_MODEL_ID)
      ) {
        this.claudeCode.resetConnection();
        throw new Error('claude_code_models_missing');
      }
      try {
        mergedCatalog(await this.codexCatalogOrEmpty(), [
          ...(this.hermesConnected && this.hermesCatalog ? [this.hermesCatalog] : []),
          catalog,
        ]);
      } catch (error) {
        this.claudeCode.resetConnection();
        throw error;
      }
      this.claudeCodeCatalog = catalog;
      this.claudeCodeConnected = true;
      this.claudeCodeConnectionEpoch += 1;
      return { catalog, collaborationModes };
    });
  }

  disconnectClaudeCode() {
    return this.runClaudeCodeLifecycle(async () => {
      const threadIds = [...this.threads]
        .filter(([, route]) => route.providerId === CLAUDE_CODE_PROVIDER_ID)
        .map(([threadId]) => threadId);
      this.claudeCodeConnected = false;
      this.claudeCodeCatalog = null;
      this.claudeCodeConnectionEpoch += 1;
      for (const threadId of threadIds) this.threads.delete(threadId);
      this.claudeCode?.resetConnection();
      this.emit('disconnected', { providerId: CLAUDE_CODE_PROVIDER_ID });
    });
  }

  disconnectHermes() {
    return this.runHermesLifecycle(async () => {
      const threadIds = [...this.threads]
        .filter(([, route]) => route.providerId === HERMES_PROVIDER_ID)
        .map(([threadId]) => threadId);
      this.hermesConnected = false;
      this.hermesCatalog = null;
      this.hermesConnectionEpoch += 1;
      for (const threadId of threadIds) this.threads.delete(threadId);
      this.hermes.resetConnection();
      this.emit('disconnected', { providerId: HERMES_PROVIDER_ID });
    });
  }

  async listModelCatalog() {
    const optionalCatalogs = [
      ...(this.hermesConnected && this.hermesCatalog ? [this.hermesCatalog] : []),
      ...(this.claudeCodeConnected && this.claudeCodeCatalog ? [this.claudeCodeCatalog] : []),
    ];
    if (optionalCatalogs.length === 0) return this.codex.listModelCatalog();
    return mergedCatalog(await this.codexCatalogOrEmpty(), optionalCatalogs);
  }

  /** Branch-title generation stays on Codex while the user chats through a local provider. */
  listBranchTitleModelCatalog() {
    return this.codex.listModelCatalog();
  }

  listCollaborationModeCatalog(modelId?: string | null) {
    if (modelId === HERMES_CONFIGURED_MODEL_ID) {
      this.requireHermesConnected();
      return this.hermes.listCollaborationModeCatalog();
    }
    if (this.isClaudeCodeModel(modelId)) {
      this.requireClaudeCodeConnected();
      return this.claudeCode!.listCollaborationModeCatalog(modelId);
    }
    return this.codex.listCollaborationModeCatalog();
  }

  async startThread(input: Parameters<ProjectChatCodex['startThread']>[0]) {
    const providerId = this.providerForModel(input.modelId);
    const provider = this.provider(providerId);
    const connectionEpoch =
      providerId === HERMES_PROVIDER_ID
        ? this.hermesConnectionEpoch
        : providerId === CLAUDE_CODE_PROVIDER_ID
          ? this.claudeCodeConnectionEpoch
          : 0;
    const started = await provider.startThread(input);
    if (
      providerId === HERMES_PROVIDER_ID &&
      (!this.hermesConnected || connectionEpoch !== this.hermesConnectionEpoch)
    ) {
      await provider.releaseThread(started.threadId).catch(() => undefined);
      throw new Error('hermes_not_connected');
    }
    if (
      providerId === CLAUDE_CODE_PROVIDER_ID &&
      (!this.claudeCodeConnected || connectionEpoch !== this.claudeCodeConnectionEpoch)
    ) {
      await provider.releaseThread(started.threadId).catch(() => undefined);
      throw new Error('claude_code_not_connected');
    }
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
    if (this.isClaudeCodeModel(modelId)) {
      this.requireClaudeCodeConnected();
      return CLAUDE_CODE_PROVIDER_ID;
    }
    return CODEX_PROVIDER_ID;
  }

  private provider(providerId: ProviderId): ProjectChatCodex {
    if (providerId === HERMES_PROVIDER_ID) return this.hermes;
    if (providerId === CLAUDE_CODE_PROVIDER_ID) {
      if (!this.claudeCode) throw new Error('claude_code_provider_unavailable');
      return this.claudeCode;
    }
    return this.codex;
  }

  private threadProvider(threadId: string): ProviderId {
    const route = this.threads.get(threadId);
    if (!route) throw new Error('project_chat_thread_not_found');
    if (route.providerId === HERMES_PROVIDER_ID) this.requireHermesConnected();
    if (route.providerId === CLAUDE_CODE_PROVIDER_ID) this.requireClaudeCodeConnected();
    return route.providerId;
  }

  private requireHermesConnected() {
    if (!this.hermesConnected || !this.hermesCatalog) {
      throw new Error('hermes_not_connected');
    }
  }

  private async codexCatalogOrEmpty() {
    return this.codex.listModelCatalog().catch(() => emptyCodexCatalog());
  }

  private requireClaudeCodeConnected() {
    if (!this.claudeCodeConnected || !this.claudeCodeCatalog || !this.claudeCode) {
      throw new Error('claude_code_not_connected');
    }
  }

  private isClaudeCodeModel(modelId: string | null | undefined) {
    return (
      modelId === CLAUDE_CODE_SONNET_MODEL_ID ||
      modelId === CLAUDE_CODE_OPUS_MODEL_ID ||
      modelId === CLAUDE_CODE_OPUS_5_MODEL_ID
    );
  }

  private runHermesLifecycle<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.hermesLifecycleTail.then(operation, operation);
    this.hermesLifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private runClaudeCodeLifecycle<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.claudeCodeLifecycleTail.then(operation, operation);
    this.claudeCodeLifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertThreadPrefix(providerId: ProviderId, threadId: string) {
    const hermesPrefix = threadId.startsWith('hermes:');
    const claudeCodePrefix = threadId.startsWith('claude-code:');
    if (
      (providerId === HERMES_PROVIDER_ID && !hermesPrefix) ||
      (providerId === CLAUDE_CODE_PROVIDER_ID && !claudeCodePrefix) ||
      (providerId === CODEX_PROVIDER_ID && (hermesPrefix || claudeCodePrefix)) ||
      (providerId === HERMES_PROVIDER_ID && claudeCodePrefix) ||
      (providerId === CLAUDE_CODE_PROVIDER_ID && hermesPrefix)
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
    provider.on('usage', (event: { threadId?: string; turnId?: string }) => {
      if (!event.threadId || this.threads.get(event.threadId)?.providerId !== providerId) return;
      this.emit('usage', event);
    });
    provider.on('disconnected', () => {
      for (const [threadId, route] of this.threads) {
        if (route.providerId === providerId) this.threads.delete(threadId);
      }
      if (providerId === HERMES_PROVIDER_ID) {
        this.hermesConnected = false;
        this.hermesCatalog = null;
      }
      if (providerId === CLAUDE_CODE_PROVIDER_ID) {
        this.claudeCodeConnected = false;
        this.claudeCodeCatalog = null;
      }
      this.emit('disconnected', { providerId });
    });
  }
}

export type HermesProjectChatConnection = Pick<
  ProjectChatProviderRouter,
  'connectHermes' | 'disconnectHermes' | 'isHermesConnected'
>;

export type ClaudeCodeProjectChatConnection = Pick<
  ProjectChatProviderRouter,
  'connectClaudeCode' | 'disconnectClaudeCode' | 'isClaudeCodeConnected'
>;
