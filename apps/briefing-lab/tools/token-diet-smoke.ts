import { createHash } from 'node:crypto';
import { assembleProjectChatPrompt } from '../../desktop/src/main/project-chat-prompt';
const id = '11111111-1111-4111-8111-111111111111',
  now = '2026-09-14T00:00:00Z';
const input = {
  snapshot: {
    schemaVersion: 1 as const,
    revision: 1,
    projects: [
      { id, name: 'Synthetic', slug: 'synthetic', version: 1, createdAt: now, updatedAt: now },
    ],
    tasks: [],
    objectives: [],
  },
  projectId: id,
  message: '살아있나?',
  priorMessages: Array.from({ length: 160 }, (_, i) => ({
    id: `message-${i}`,
    projectId: id,
    role: i % 2 ? ('assistant' as const) : ('user' as const),
    status: 'complete' as const,
    content: 'SYNTHETIC_EXPERIMENT_HISTORY '.repeat(200),
    actions: [],
    createdAt: now,
    completedAt: now,
  })),
  harnessMode: 'context' as const,
  responseDepth: 'standard' as const,
  contextScope: 'project' as const,
  profileVersion: 0,
  instructionRevisionId: null,
  customInstructions: 'Be concise',
  policyRules: ['Preserve research rules'],
  nativeCollaborationModeId: 'default',
  nativeExecutionKind: 'default' as const,
  nativeCollaborationCatalogSha256: createHash('sha256').update('synthetic').digest('hex'),
  nativePersonality: 'auto' as const,
  nativeResponseVerbosity: 'auto' as const,
  effectiveReasoningOptionId: null,
  contextWindowTokens: 1000000,
  contextWindowSource: 'provider' as const,
};
const before = assembleProjectChatPrompt({ ...input, allowContextSelection: false });
const after = assembleProjectChatPrompt(input);
const count = (p: typeof before) =>
  (p.contextPlan.estimatedPromptTokens ?? 0) + (p.contextPlan.developerInstructionTokens ?? 0);
console.log(
  JSON.stringify({
    synthetic: true,
    realProviderCall: false,
    messageCount: 160,
    estimatedInputBefore: count(before),
    estimatedInputAfter: count(after),
    reductionPercent: Math.round((1 - count(after) / count(before)) * 10000) / 100,
    originalMessagesPreserved: input.priorMessages.length,
  }),
);
