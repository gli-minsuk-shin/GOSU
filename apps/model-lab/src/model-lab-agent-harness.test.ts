import { describe, expect, it, vi } from 'vitest';

import {
  executeModelLabAgentTool,
  MODEL_LAB_AGENT_MAX_STEPS,
  MODEL_LAB_AGENT_STEP_SCHEMA,
  runModelLabAgentHarness,
  type ModelLabAgentProvider,
} from './model-lab-agent-harness';
import type { ModelLabQuestionRequest } from './model-lab-runtime-adapter';
import { sparkvskLearnedWarmPath, tropicLambdaPathCompiler } from './sample-models';

function request(): ModelLabQuestionRequest {
  return {
    projectModels: [sparkvskLearnedWarmPath, tropicLambdaPathCompiler],
    activeModelId: sparkvskLearnedWarmPath.id,
    selectedModuleId: 'sparkvsk-lambda-query',
    probe: 'healthy',
    checkpointIndex: 4,
    question: 'Trace lambda through the selected module.',
    conversation: [{ role: 'user', body: 'Use exact tensor evidence.' }],
  };
}

function provider(providerName: string) {
  let step = 0;
  const complete: ModelLabAgentProvider = vi.fn(async (prompt, _signal, schema) => {
    expect(schema).toBe(MODEL_LAB_AGENT_STEP_SCHEMA);
    step += 1;
    if (step === 1) {
      expect(prompt).toContain('AVAILABLE GOSU MODEL LAB TOOLS');
      return {
        body: JSON.stringify({
          kind: 'tool_calls',
          calls: [
            {
              id: 'call-1',
              name: 'inspect_module',
              argumentsJson: JSON.stringify({
                modelId: sparkvskLearnedWarmPath.id,
                moduleId: 'sparkvsk-lambda-query',
              }),
            },
          ],
          answer: null,
          editInstructions: null,
        }),
        provider: providerName,
        model: `${providerName}-model`,
        reasoning: 'high',
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          cachedReadTokens: 40,
          cachedWriteTokens: 5,
          totalTokens: 110,
        },
      };
    }
    expect(prompt).toContain('GOSU TOOL RECEIPTS');
    expect(prompt).toContain('sparkvsk-lambda-query');
    return {
      body: JSON.stringify({
        kind: 'final',
        calls: [],
        answer: 'Lambda enters the selected query encoder with a verified module receipt.',
        editInstructions: null,
      }),
      provider: providerName,
      model: `${providerName}-model`,
      reasoning: 'high',
      usage: {
        inputTokens: 60,
        outputTokens: 8,
        cachedReadTokens: 20,
        cachedWriteTokens: 0,
        totalTokens: 68,
      },
    };
  });
  return complete;
}

describe('provider-neutral Model Lab agent harness', () => {
  it.each(['Codex CLI', 'Claude Code subscription'])(
    'runs the same inspect-receipt-final loop for %s',
    async (providerName) => {
      const complete = provider(providerName);
      const progress = vi.fn();

      const result = await runModelLabAgentHarness({
        request: request(),
        seedPrompt: 'Bounded model seed',
        provider: complete,
        signal: new AbortController().signal,
        onProgress: progress,
      });

      expect(result).toMatchObject({
        provider: providerName,
        body: expect.stringContaining('verified module receipt'),
        trace: ['Agent step 1 · inspect_module · receipt', 'Agent step 2 · final'],
        usage: {
          inputTokens: 160,
          outputTokens: 18,
          cachedReadTokens: 60,
          cachedWriteTokens: 5,
          totalTokens: 178,
        },
      });
      expect(complete).toHaveBeenCalledTimes(2);
      expect(progress).toHaveBeenCalledWith({
        step: 1,
        phase: 'tool_completed',
        tool: 'inspect_module',
        success: true,
      });
    },
  );

  it('returns bounded module, path, gradient, and comparison receipts', () => {
    const input = request();
    expect(
      executeModelLabAgentTool(
        input,
        'inspect_module',
        JSON.stringify({ moduleId: 'sparkvsk-lambda-query' }),
      ),
    ).toContain('model_spark_vs.py:29-37, 167-176');
    expect(
      executeModelLabAgentTool(
        input,
        'trace_connections',
        JSON.stringify({ moduleId: 'sparkvsk-lambda-query', direction: 'downstream' }),
      ),
    ).toContain('layers');
    expect(
      executeModelLabAgentTool(
        input,
        'inspect_gradient',
        JSON.stringify({ moduleId: 'sparkvsk-lambda-query' }),
      ),
    ).toContain('checkpointIndex');
    expect(
      executeModelLabAgentTool(
        input,
        'compare_models',
        JSON.stringify({
          modelIds: [sparkvskLearnedWarmPath.id, tropicLambdaPathCompiler.id],
        }),
      ),
    ).toContain(tropicLambdaPathCompiler.name);
  });

  it('returns a bounded architecture-edit intent separately from the explanatory answer', async () => {
    const complete: ModelLabAgentProvider = vi.fn(async () => ({
      body: JSON.stringify({
        kind: 'final',
        calls: [],
        answer: 'I will prepare a reviewable proposal; the graph is not changed yet.',
        editInstructions:
          'Change the prediction head output from 10 logits to 2 logits and preserve every upstream block.',
      }),
      provider: 'fixture',
      model: 'fixture-model',
      reasoning: 'high',
    }));

    await expect(
      runModelLabAgentHarness({
        request: request(),
        seedPrompt: 'Bounded model seed',
        provider: complete,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      body: expect.stringContaining('not changed yet'),
      editInstructions: expect.stringContaining('output from 10 logits to 2 logits'),
    });
  });

  it('stops at the shared step bound instead of looping indefinitely', async () => {
    const complete: ModelLabAgentProvider = vi.fn(async () => ({
      body: JSON.stringify({
        kind: 'tool_calls',
        calls: [{ id: 'repeat', name: 'list_models', argumentsJson: '{}' }],
        answer: null,
        editInstructions: null,
      }),
      provider: 'fixture',
      model: 'fixture',
      reasoning: 'high',
    }));

    await expect(
      runModelLabAgentHarness({
        request: request(),
        seedPrompt: 'Bounded model seed',
        provider: complete,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('model_copilot_agent_step_limit');
    expect(complete).toHaveBeenCalledTimes(MODEL_LAB_AGENT_MAX_STEPS);
  });
});
