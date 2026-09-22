import { runRoutineAgent } from '../briefing-native';
import { searchAssistantImages } from '../briefing-web-images';
if (!process.argv.includes('--live'))
  throw Error(
    'Explicit --live required: one public search subscription call and Commons request. No private data.',
  );
let searches = 0;
const result = await runRoutineAgent(
  {
    providerId: 'codex',
    modelId: 'gpt-6-astra',
    reasoning: 'low',
    prompt: 'Public search transport test',
    history: [],
    previousProposal: null,
  },
  AbortSignal.timeout(90000),
  (p) => {
    if (p.detail.includes('웹 검색')) searches++;
  },
  {
    timeoutMs: 85000,
    structuredJob: {
      webSearchMode: 'live',
      instructions:
        'Use native web search, not memory, to find the official OpenAI Codex configuration reference. Return JSON answer with one normal HTTPS source link and one sentence describing web_search=live. Do not inspect local files or private data.',
      prompt: 'Search official Codex configuration reference for web_search live.',
      schema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
        additionalProperties: false,
      },
    },
  },
);
console.log(JSON.stringify({ model: result.model, searchEvents: searches, answer: result.answer }));
if (!searches) throw Error('No actual native webSearch event observed');
const images = await searchAssistantImages('Yonsei University', AbortSignal.timeout(15000));
console.log(
  JSON.stringify({
    imageSource: images.source,
    imageCount: images.images.length,
    first: images.images[0],
  }),
);
