import { runRoutineAgent } from '../briefing-native';
if (!process.argv.includes('--live'))
  throw new Error('Explicit --live required: one synthetic subscription model call.');
const started = Date.now();
const result = await runRoutineAgent(
  {
    providerId: 'codex',
    modelId: 'gpt-6-astra',
    reasoning: 'low',
    prompt: 'Reply ready.',
    history: [],
    previousProposal: null,
  },
  AbortSignal.timeout(90000),
  () => undefined,
  {
    timeoutMs: 85000,
    structuredJob: {
      instructions:
        'This is a synthetic transport check. Return JSON with answer set to ready. No tools or outside information.',
      prompt: 'Reply ready.',
      schema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
        additionalProperties: false,
      },
    },
  },
);
console.log(
  JSON.stringify({
    model: result.model,
    reasoning: result.reasoning,
    elapsedMs: Date.now() - started,
    usage: result.nativeUsage ?? null,
  }),
);
