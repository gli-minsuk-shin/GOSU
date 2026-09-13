import { describe, expect, it, vi } from 'vitest';
import { estimateAgentContextTokens, planAgentContextBudget } from '@gosu/contracts';

import {
  executeModelLabAgentTool,
  MODEL_LAB_AGENT_MAX_STEPS,
  MODEL_LAB_AGENT_MAX_TRANSCRIPT_CHARACTERS,
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
        trace: expect.arrayContaining([
          expect.stringContaining('Context budget · fallback 32000 window'),
          'Agent step 1 · inspect_module · receipt',
          'Agent step 2 · final',
        ]),
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

  it('deduplicates semantically identical tool calls with canonical argument ordering', async () => {
    const prompts: string[] = [];
    let step = 0;
    const complete: ModelLabAgentProvider = async (prompt) => {
      prompts.push(prompt);
      step += 1;
      if (step === 3) {
        return {
          body: JSON.stringify({
            kind: 'final',
            calls: [],
            answer: 'The repeated inspection reused the bounded receipt cache.',
            editInstructions: null,
          }),
          provider: 'fixture',
          model: 'fixture-model',
          reasoning: 'high',
        };
      }
      return {
        body: JSON.stringify({
          kind: 'tool_calls',
          calls: [
            {
              id: `call-${step}`,
              name: 'inspect_module',
              argumentsJson:
                step === 1
                  ? JSON.stringify({
                      modelId: sparkvskLearnedWarmPath.id,
                      moduleId: 'sparkvsk-lambda-query',
                    })
                  : JSON.stringify({
                      moduleId: 'sparkvsk-lambda-query',
                      modelId: sparkvskLearnedWarmPath.id,
                    }),
            },
          ],
          answer: null,
          editInstructions: null,
        }),
        provider: 'fixture',
        model: 'fixture-model',
        reasoning: 'high',
      };
    };

    await runModelLabAgentHarness({
      request: request(),
      seedPrompt: 'Bounded model seed',
      provider: complete,
      signal: new AbortController().signal,
    });

    expect(prompts.at(-1)).toContain('"cached":true');
    expect(prompts.at(-1)).toContain('receipt-1');
    expect(prompts.at(-1)).toContain('model_spark_vs.py:29-37, 167-176');
  });

  it.each([
    ['ASCII', 's'.repeat(1_000_000)],
    ['CJK', '한'.repeat(700_000)],
  ])(
    'uses a provider 1M context budget without exceeding it for %s evidence',
    async (_label, seedPrompt) => {
      let receivedPrompt = '';
      const complete: ModelLabAgentProvider = async (prompt) => {
        receivedPrompt = prompt;
        return {
          body: JSON.stringify({
            kind: 'final',
            calls: [],
            answer: 'The model-aware context was bounded.',
            editInstructions: null,
          }),
          provider: 'fixture',
          model: 'fixture-model',
          reasoning: 'high',
        };
      };

      await runModelLabAgentHarness({
        request: request(),
        seedPrompt,
        provider: complete,
        signal: new AbortController().signal,
        contextWindowTokens: 1_000_000,
      });

      const budget = planAgentContextBudget({ contextWindowTokens: 1_000_000 });
      expect(estimateAgentContextTokens(receivedPrompt)).toBeLessThanOrEqual(
        budget.availableInputTokens,
      );
      if (_label === 'ASCII') {
        expect(receivedPrompt.length).toBeGreaterThan(MODEL_LAB_AGENT_MAX_TRANSCRIPT_CHARACTERS);
      }
    },
  );

  it('bounds the accumulated tool transcript while retaining the newest receipt batch', async () => {
    const oversizedModules = Array.from({ length: 20 }, (_, index) => ({
      ...sparkvskLearnedWarmPath.modules[0]!,
      id: `oversized-module-${index}`,
      name: `Oversized module ${index}`,
      transform: `transform-${index}-${'t'.repeat(2_000)}`,
      formula: `formula-${index}-${'f'.repeat(2_000)}`,
      explanation: `explanation-${index}-${'e'.repeat(2_000)}`,
    }));
    const oversizedModel = {
      ...sparkvskLearnedWarmPath,
      modules: oversizedModules,
      connections: [],
    };
    const oversizedRequest: ModelLabQuestionRequest = {
      ...request(),
      projectModels: [oversizedModel],
      activeModelId: oversizedModel.id,
      selectedModuleId: oversizedModules[0]!.id,
    };
    const prompts: string[] = [];
    let step = 0;
    const complete: ModelLabAgentProvider = async (prompt) => {
      prompts.push(prompt);
      step += 1;
      return {
        body: JSON.stringify(
          step === MODEL_LAB_AGENT_MAX_STEPS
            ? {
                kind: 'final',
                calls: [],
                answer: 'The bounded transcript retained enough recent evidence.',
                editInstructions: null,
              }
            : {
                kind: 'tool_calls',
                calls: Array.from({ length: 3 }, (_, index) => ({
                  id: `step-${step}-call-${index}`,
                  name: 'inspect_model',
                  argumentsJson: JSON.stringify({ modelId: oversizedModel.id }),
                })),
                answer: null,
                editInstructions: null,
              },
        ),
        provider: 'fixture',
        model: 'fixture-model',
        reasoning: 'high',
      };
    };

    await expect(
      runModelLabAgentHarness({
        request: oversizedRequest,
        seedPrompt: 's'.repeat(MODEL_LAB_AGENT_MAX_TRANSCRIPT_CHARACTERS),
        provider: complete,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      body: 'The bounded transcript retained enough recent evidence.',
    });

    const actionSuffix = '\n\nChoose the next bounded action or provide the final answer.';
    expect(prompts).toHaveLength(MODEL_LAB_AGENT_MAX_STEPS);
    for (const prompt of prompts) {
      expect(prompt.length).toBeLessThanOrEqual(MODEL_LAB_AGENT_MAX_TRANSCRIPT_CHARACTERS);
      expect(prompt.endsWith(actionSuffix)).toBe(true);
      expect(prompt.slice(0, -actionSuffix.length).length).toBeLessThanOrEqual(
        MODEL_LAB_AGENT_MAX_TRANSCRIPT_CHARACTERS,
      );
    }
    expect(prompts.at(-1)).toContain(`step-${MODEL_LAB_AGENT_MAX_STEPS - 1}-call-0`);
    expect(prompts.at(-1)).toContain(`step-${MODEL_LAB_AGENT_MAX_STEPS - 1}-call-1`);
    expect(prompts.at(-1)).toContain(`step-${MODEL_LAB_AGENT_MAX_STEPS - 1}-call-2`);
    expect(prompts.at(-1)).toContain(oversizedModel.id);
  });
});
