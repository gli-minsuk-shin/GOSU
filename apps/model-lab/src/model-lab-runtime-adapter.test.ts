import { describe, expect, it, vi } from 'vitest';
import {
  createCodexModelLabRuntime,
  createGosuModelLabRuntime,
  deterministicModelLabRuntime,
  isCurrentModelLabTurn,
  MODEL_LAB_RUNTIME_ERROR_MESSAGE,
  modelLabRuntimeErrorCode,
  modelLabRuntimeErrorMessage,
} from './model-lab-runtime-adapter';
import { bottleneckAutoencoder, residualClassifier, sampleModels } from './sample-models';
import type { ModelSpec } from './model-lab-schema';
it('delivers validated context accounting events independently from tool progress', async () => {
  const report = {
    windowTokens: 1000000,
    windowSource: 'provider',
    estimatedInputTokens: 1000,
    outputReserveTokens: 120000,
    toolReserveTokens: 128000,
    totalMessages: 600,
    includedMessages: 600,
    compressedMessages: 0,
    omittedMessages: 0,
  };
  const onContextUsage = vi.fn();
  const events = [
    { type: 'context-usage', usage: { ...report, windowTokens: -1 } },
    { type: 'context-usage', usage: report },
    { type: 'result', answer: { body: 'Answer', trace: [], contextUsage: report } },
  ];
  const runtime = createGosuModelLabRuntime(
    async () =>
      new Response(events.map((event) => JSON.stringify(event)).join('\n') + '\n', {
        headers: { 'Content-Type': 'application/x-ndjson' },
      }),
  );
  const answer = await runtime.answer(
    {
      projectModels: [residualClassifier],
      activeModelId: residualClassifier.id,
      selectedModuleId: 'merge',
      question: 'Continue',
      probe: 'healthy',
      checkpointIndex: 0,
    },
    { onContextUsage },
  );
  expect(onContextUsage).toHaveBeenCalledOnce();
  expect(answer.contextUsage?.totalMessages).toBe(600);
});

it('surfaces actionable native auth errors without exposing provider diagnostics', () => {
  expect(modelLabRuntimeErrorCode('claude_code_auth_required')).toBe('claude_code_auth_required');
  expect(modelLabRuntimeErrorMessage(new Error('claude_code_auth_required'))).toContain(
    'Sign in again',
  );
  expect(modelLabRuntimeErrorMessage(new Error('private token and raw log'))).toBe(
    MODEL_LAB_RUNTIME_ERROR_MESSAGE,
  );
});

function withExplicitPorts(model: ModelSpec): ModelSpec {
  return {
    ...model,
    modules: model.modules.map((module) => {
      const incoming = model.connections.filter((connection) => connection.target === module.id);
      const outgoing = model.connections.filter((connection) => connection.source === module.id);
      return {
        ...module,
        inputPorts:
          incoming.length > 0
            ? incoming.map((connection) => ({
                name: `input:${connection.id}`,
                shape: connection.shape,
                binding: 'internal' as const,
              }))
            : [{ name: 'external input', shape: module.inputShape, binding: 'external' as const }],
        outputPorts:
          outgoing.length > 0
            ? outgoing.map((connection) => ({
                name: `output:${connection.id}`,
                shape: connection.shape,
                binding: 'internal' as const,
              }))
            : [
                {
                  name: 'external output',
                  shape: module.outputShape,
                  binding: 'external' as const,
                },
              ],
      };
    }),
    connections: model.connections.map((connection) => ({
      ...connection,
      sourcePort: `output:${connection.id}`,
      targetPort: `input:${connection.id}`,
    })),
  };
}

describe('Model Lab runtime adapter boundary', () => {
  it('qualifies an answer to one immutable model, module, and gradient checkpoint', async () => {
    const result = await deterministicModelLabRuntime.answer({
      projectModels: sampleModels,
      activeModelId: residualClassifier.id,
      selectedModuleId: 'merge',
      probe: 'detached',
      checkpointIndex: 4,
      question: 'Does gradient reach this module?',
    });

    expect(result.body).toMatch(/detached|blocked/i);
    expect(result.trace).toEqual([
      `${residualClassifier.name}@${residualClassifier.version}`,
      `Project model registry · ${sampleModels.length}`,
      'merge',
      'Deterministic evidence reader',
    ]);
  });

  it('keeps the portable boundary asynchronous for a future GOSU Agent Runtime adapter', async () => {
    const reviews = await deterministicModelLabRuntime.review({
      projectModels: sampleModels,
      activeModelId: residualClassifier.id,
      probe: 'healthy',
      checkpointIndex: 4,
    });

    expect(deterministicModelLabRuntime.mode).toBe('deterministic-local');
    expect(reviews).toHaveLength(5);
    expect(reviews.every((review) => review.status === 'pass')).toBe(true);
  });

  it('audits every model supplied in the project registry, not only the selected model', async () => {
    const inconsistentModel = {
      ...bottleneckAutoencoder,
      id: 'inconsistent-secondary-model',
      modules: bottleneckAutoencoder.modules.map((module, index) =>
        index === 1
          ? {
              ...module,
              transform: 'H = Linear_{2d->2d}(H)',
              activation: null,
              formula: String.raw`H_3=W_2\operatorname{GELU}(W_1H+b_1)+b_2`,
            }
          : module,
      ),
    };
    const reviews = await deterministicModelLabRuntime.review({
      projectModels: [residualClassifier, inconsistentModel],
      activeModelId: residualClassifier.id,
      probe: 'healthy',
      checkpointIndex: 4,
    });
    const formulaReview = reviews.find((review) => review.id === 'formula-auditor');

    expect(formulaReview?.status).toBe('error');
    expect(formulaReview?.evidence).toEqual(
      expect.arrayContaining([expect.stringContaining('inconsistent-secondary-model')]),
    );
  });

  it('fails closed when a runtime request names a model outside the project registry', async () => {
    await expect(
      deterministicModelLabRuntime.answer({
        projectModels: sampleModels,
        activeModelId: 'not-in-project',
        selectedModuleId: 'merge',
        probe: 'healthy',
        checkpointIndex: 4,
        question: 'Compare this model.',
      }),
    ).rejects.toThrow('model_lab_runtime_active_model_missing');
  });

  it('accepts a completed turn only while its sequence, model id, and version remain active', () => {
    const turn = {
      sequence: 7,
      modelId: residualClassifier.id,
      modelVersion: residualClassifier.version,
    };

    expect(isCurrentModelLabTurn(turn, 7, residualClassifier)).toBe(true);
    expect(isCurrentModelLabTurn(turn, 8, residualClassifier)).toBe(false);
    expect(isCurrentModelLabTurn(turn, 7, bottleneckAutoencoder)).toBe(false);
    expect(
      isCurrentModelLabTurn(turn, 7, {
        id: residualClassifier.id,
        version: `${residualClassifier.version}-new`,
      }),
    ).toBe(false);
  });

  it('uses a bounded runtime failure message without exposing provider errors', () => {
    expect(MODEL_LAB_RUNTIME_ERROR_MESSAGE.length).toBeLessThan(220);
    expect(MODEL_LAB_RUNTIME_ERROR_MESSAGE).toContain('no answer was generated');
    expect(MODEL_LAB_RUNTIME_ERROR_MESSAGE).toContain('No deterministic substitute was used');
    expect(MODEL_LAB_RUNTIME_ERROR_MESSAGE).not.toContain('stack');
  });

  it('routes Model Copilot questions to the Codex LLM endpoint with conversation context', async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          body: 'λ enters through lambda_ratio × lambda_max and is embedded in q.',
          trace: ['Codex CLI · gpt-5.6-sol', 'Reasoning high'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const runtime = createCodexModelLabRuntime(fetchMock);
    const request = {
      projectModels: sampleModels,
      activeModelId: residualClassifier.id,
      selectedModuleId: 'merge',
      probe: 'healthy' as const,
      checkpointIndex: 4,
      question: 'Where does lambda enter?',
      conversation: [{ role: 'user' as const, body: 'Trace the conditioning path.' }],
      attachments: [
        {
          name: 'notes.md',
          mediaType: 'text/markdown',
          kind: 'text' as const,
          encoding: 'utf8' as const,
          content: 'Compare this note to the graph.',
        },
      ],
      selection: {
        providerId: 'codex',
        requestedModelId: 'gpt-5.6-sol',
        reasoningOptionId: 'high',
      },
    };

    const result = await runtime.answer(request);

    expect(runtime.mode).toBe('gosu-agent-runtime');
    expect(result.body).toContain('lambda_ratio');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe('/api/model-copilot');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      question: request.question,
      conversation: request.conversation,
      attachments: request.attachments,
      selection: request.selection,
    });
  });

  it('accepts a validated chat edit proposal without mutating the active model itself', async () => {
    const runtime = createCodexModelLabRuntime(
      async () =>
        new Response(
          JSON.stringify({
            body: 'A reviewable two-class head proposal is ready.',
            trace: ['Chat edit proposal validated'],
            editProposal: {
              model: withExplicitPorts(residualClassifier),
              instructions: 'Change the prediction head to two outputs.',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const answer = await runtime.answer({
      projectModels: sampleModels,
      activeModelId: residualClassifier.id,
      selectedModuleId: 'head',
      probe: 'healthy',
      checkpointIndex: 4,
      question: 'Change the prediction head to two outputs.',
      purpose: 'chat',
    });

    expect(answer.editProposal).toMatchObject({
      model: { id: residualClassifier.id },
      instructions: 'Change the prediction head to two outputs.',
    });
    expect(residualClassifier.intent.expectedOutput).toEqual(['B', 10]);
  });

  it('streams the same provider-neutral agent progress contract for GPT and Claude', async () => {
    const progress = vi.fn();
    const fetchMock: typeof fetch = async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const event of [
              { type: 'progress', progress: { step: 1, phase: 'thinking' } },
              {
                type: 'progress',
                progress: {
                  step: 1,
                  phase: 'tool_completed',
                  tool: 'inspect_module',
                  success: true,
                },
              },
              {
                type: 'result',
                answer: {
                  body: 'Receipt-grounded answer.',
                  trace: ['Provider-neutral GOSU agent harness'],
                  usage: {
                    inputTokens: 100,
                    outputTokens: 20,
                    cachedReadTokens: 40,
                    cachedWriteTokens: 0,
                    totalTokens: 120,
                  },
                },
              },
            ]) {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            }
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
      );
    };
    const runtime = createCodexModelLabRuntime(fetchMock);

    const answer = await runtime.answer(
      {
        projectModels: sampleModels,
        activeModelId: residualClassifier.id,
        selectedModuleId: 'merge',
        probe: 'healthy',
        checkpointIndex: 4,
        question: 'Inspect this module.',
        selection: {
          providerId: 'claude-code',
          requestedModelId: 'claude-code:opus-5',
          reasoningOptionId: 'high',
        },
      },
      { onProgress: progress },
    );

    expect(answer.body).toBe('Receipt-grounded answer.');
    expect(answer.usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith({
      step: 1,
      phase: 'tool_completed',
      tool: 'inspect_module',
      success: true,
    });
  });

  it('passes one Stop signal through the common runtime regardless of provider', async () => {
    let observedSignal: AbortSignal | null = null;
    const runtime = createCodexModelLabRuntime(async (_input, init) => {
      observedSignal = init?.signal as AbortSignal;
      return await new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    });
    const controller = new AbortController();
    const pending = runtime.answer(
      {
        projectModels: sampleModels,
        activeModelId: residualClassifier.id,
        selectedModuleId: 'merge',
        probe: 'healthy',
        checkpointIndex: 4,
        question: 'Stop this provider-neutral turn.',
        selection: {
          providerId: 'claude-code',
          requestedModelId: 'claude-code:opus-5',
          reasoningOptionId: 'high',
        },
      },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(pending).rejects.toThrow('aborted');
    expect(observedSignal).toBe(controller.signal);
    expect(controller.signal.aborted).toBe(true);
  });

  it('fails closed when the Codex endpoint is unavailable instead of using deterministic text', async () => {
    const runtime = createCodexModelLabRuntime(
      async () =>
        new Response(JSON.stringify({ error: 'model_copilot_unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await expect(
      runtime.answer({
        projectModels: sampleModels,
        activeModelId: residualClassifier.id,
        selectedModuleId: 'merge',
        probe: 'healthy',
        checkpointIndex: 4,
        question: 'Invent an answer if the LLM is down.',
      }),
    ).rejects.toThrow('model_copilot_llm_unavailable');
  });

  it('reports the concrete Codex provider, model, and reasoning level', async () => {
    const runtime = createCodexModelLabRuntime(
      async () =>
        new Response(
          JSON.stringify({
            available: true,
            provider: 'codex-cli 0.149.0',
            model: 'gpt-5.6-sol',
            reasoning: 'high',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    await expect(runtime.status?.()).resolves.toEqual({
      available: true,
      provider: 'codex-cli 0.149.0',
      model: 'gpt-5.6-sol',
      reasoning: 'high',
    });
  });

  it('loads the same provider-opaque ModelCatalog shape used by GOSU model pickers', async () => {
    const catalog = {
      schemaVersion: 1,
      providerId: 'gosu-project-chat',
      catalogVersion: 'catalog-v1',
      fetchedAt: '2026-08-25T00:00:00.000Z',
      models: [
        {
          schemaVersion: 1,
          providerId: 'codex',
          modelId: 'gpt-5.6-sol',
          displayName: 'GPT-5.6-Sol',
          catalogVersion: 'catalog-v1',
          isDefault: true,
          modalities: ['text', 'image'],
          reasoningOptions: [{ id: 'high', label: 'high', isDefault: true }],
        },
      ],
    };
    const calls: Array<RequestInfo | URL> = [];
    const runtime = createCodexModelLabRuntime(async (input) => {
      calls.push(input);
      return new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(runtime.listModels?.()).resolves.toEqual(catalog);
    await expect(runtime.listModels?.({ refresh: true })).resolves.toEqual(catalog);
    expect(calls).toEqual(['/api/model-copilot/models', '/api/model-copilot/models?refresh=1']);
  });
});
