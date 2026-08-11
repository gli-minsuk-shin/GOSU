import { describe, expect, it } from 'vitest';

import {
  ProjectChatProviderOperationQueue,
  reconcileRemovedProjectChatProvider,
  selectProjectChatModel,
  selectProjectChatReasoning,
} from '../src/renderer/src/project-chat-provider-selection';

describe('Project Chat provider selection', () => {
  it('serializes provider lifecycle operations and continues after a failed operation', async () => {
    const queue = new ProjectChatProviderOperationQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(async () => {
      events.push('connect:start');
      await firstGate;
      events.push('connect:end');
      return 'connected';
    });
    const second = queue.enqueue(async () => {
      events.push('disconnect');
      throw new Error('disconnect_failed');
    });
    const third = queue.enqueue(async () => {
      events.push('reconnect');
      return 'reconnected';
    });

    await Promise.resolve();
    expect(events).toEqual(['connect:start']);
    releaseFirst();
    await expect(first).resolves.toBe('connected');
    await expect(second).rejects.toThrow('disconnect_failed');
    await expect(third).resolves.toBe('reconnected');
    expect(events).toEqual(['connect:start', 'connect:end', 'disconnect', 'reconnect']);
  });

  it('preserves an explicitly selected Hermes model when its live connection fails', () => {
    const selection = {
      providerId: 'hermes',
      modelId: 'hermes-configured-model',
      reasoningOptionId: 'high',
    } as const;

    expect(
      reconcileRemovedProjectChatProvider(selection, {
        removedProviderId: 'hermes',
        reason: 'transient-failure',
      }),
    ).toBe(selection);
  });

  it('clears model and reasoning atomically only after an explicit disconnect', () => {
    expect(
      reconcileRemovedProjectChatProvider(
        {
          providerId: 'hermes',
          modelId: 'hermes-configured-model',
          reasoningOptionId: 'ultra',
        },
        {
          removedProviderId: 'hermes',
          reason: 'explicit-disconnect',
        },
      ),
    ).toEqual({ providerId: null, modelId: null, reasoningOptionId: null });

    const codex = {
      providerId: 'codex',
      modelId: 'gpt-current',
      reasoningOptionId: 'xhigh',
    } as const;
    expect(
      reconcileRemovedProjectChatProvider(codex, {
        removedProviderId: 'hermes',
        reason: 'explicit-disconnect',
      }),
    ).toBe(codex);
  });

  it('clears stale reasoning when the provider changes and retains it within one provider', () => {
    const codex = {
      providerId: 'codex',
      modelId: 'gpt-current',
      reasoningOptionId: 'medium',
    } as const;
    const nextCodex = selectProjectChatModel(codex, {
      providerId: 'codex',
      modelId: 'gpt-next',
    });
    expect(nextCodex).toEqual({
      providerId: 'codex',
      modelId: 'gpt-next',
      reasoningOptionId: 'medium',
    });

    const hermes = selectProjectChatModel(nextCodex, {
      providerId: 'hermes',
      modelId: 'hermes-configured-model',
    });
    expect(hermes).toEqual({
      providerId: 'hermes',
      modelId: 'hermes-configured-model',
      reasoningOptionId: null,
    });
    expect(selectProjectChatReasoning(hermes, 'high')).toEqual({
      providerId: 'hermes',
      modelId: 'hermes-configured-model',
      reasoningOptionId: 'high',
    });
  });
});
