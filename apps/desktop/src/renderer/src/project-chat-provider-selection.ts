export type ProjectChatModelSelection = Readonly<{
  providerId: string | null;
  modelId: string | null;
  reasoningOptionId: string | null;
}>;

export class ProjectChatProviderOperationQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const queued = this.tail.then(operation);
    this.tail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }
}

const HERMES_PROVIDER_FAILURE_CODES = [
  'hermes_runtime_check_failed',
  'hermes_not_connected',
  'codex_unavailable',
  'chat_unavailable',
] as const;

export function isSelectedHermesProviderFailure(providerId: string | null, error: unknown) {
  if (providerId !== 'hermes' || !(error instanceof Error)) return false;
  return HERMES_PROVIDER_FAILURE_CODES.some((code) => error.message.includes(code));
}

export function selectProjectChatModel(
  current: ProjectChatModelSelection,
  next: Readonly<{ providerId: string | null; modelId: string | null }>,
): ProjectChatModelSelection {
  return {
    providerId: next.providerId,
    modelId: next.modelId,
    reasoningOptionId: next.providerId === current.providerId ? current.reasoningOptionId : null,
  };
}

export function selectProjectChatReasoning(
  current: ProjectChatModelSelection,
  reasoningOptionId: string | null,
): ProjectChatModelSelection {
  return { ...current, reasoningOptionId };
}

export function reconcileRemovedProjectChatProvider(
  current: ProjectChatModelSelection,
  input: Readonly<{
    removedProviderId: string;
    reason: 'transient-failure' | 'explicit-disconnect';
  }>,
): ProjectChatModelSelection {
  if (input.reason === 'transient-failure' || current.providerId !== input.removedProviderId) {
    return current;
  }
  return { providerId: null, modelId: null, reasoningOptionId: null };
}
