import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ModelDescriptor } from '@gosu/contracts';
import {
  compactConversationNow,
  prepareConversationContext,
  type ConversationCheckpoint,
} from '../../../briefing-lab/briefing-context';
import type { ConversationMessage } from '../../../briefing-lab/src/briefing-conversation';
import {
  contextConfigurationMatches,
  type ContextUsage,
} from '../../../briefing-lab/src/context-usage';
import type { ProjectChatMessage } from '../shared/project-chat-contracts';
import { withNativeUsageScope } from '../../../briefing-lab/native-usage-observer';

export const ProjectContextCheckpointSchema = z.object({
  scope: z.string().length(64),
  through: z.number().int().nonnegative().max(5000),
  digest: z.string().length(64),
  summary: z.string().max(24000),
  createdAt: z.string().datetime(),
});
export type ProjectContextCheckpoint = z.infer<typeof ProjectContextCheckpointSchema>;
export const projectContextScope = (
  projectId: string,
  sessionId: string,
  providerId: string,
  profileVersion: number,
) =>
  createHash('sha256')
    .update(JSON.stringify([projectId, sessionId, providerId, profileVersion]))
    .digest('hex');
export const projectTranscript = (messages: readonly ProjectChatMessage[]): ConversationMessage[] =>
  messages.map((m) => ({ role: m.role, text: m.content, createdAt: m.createdAt }));

/**
 * The window a session's context is planned against: what the provider reported for this model on
 * an earlier turn, else the catalog's value, else a fallback that compaction does not trust.
 */
export function resolveProjectContextWindow(
  contextModel: ModelDescriptor | undefined,
  contextState: { usage?: ContextUsage; modelId?: string } | undefined,
  fallbackWindowTokens: number | undefined,
) {
  const observedWindow =
    contextState?.modelId === contextModel?.modelId &&
    contextConfigurationMatches(contextModel, contextState?.usage)
      ? contextState?.usage?.native?.contextWindowTokens
      : null;
  const contextWindowTokens = Math.min(
    observedWindow ?? contextModel?.contextWindowTokens ?? fallbackWindowTokens ?? 32000,
    2_000_000,
  );
  const contextWindowSource = observedWindow
    ? ('provider' as const)
    : contextModel?.metadata?.contextWindowSource === 'configured'
      ? ('configured' as const)
      : contextModel?.metadata?.contextWindowSource === 'fallback' || !contextModel
        ? ('fallback' as const)
        : ('provider' as const);
  return { contextWindowTokens, contextWindowSource };
}

/**
 * `/compact`: the engine, usage scope and checkpoint of a turn's own compaction, run because the
 * reader asked and not because the window is under pressure. Records are never removed.
 */
export async function compactProjectContextNow(input: {
  projectId: string;
  model: ModelDescriptor;
  messages: readonly ProjectChatMessage[];
  fixedText: string;
  scope: string;
  checkpoint?: ProjectContextCheckpoint;
  compact: (messages: readonly ConversationMessage[], summary: string) => Promise<string>;
  save: (checkpoint: ProjectContextCheckpoint) => Promise<void>;
}) {
  if (input.messages.some((m) => m.projectId !== input.projectId))
    throw new Error('project_chat_context_scope_mismatch');
  const result = await compactConversationNow(
    input.model,
    projectTranscript(input.messages),
    input.fixedText,
    input.checkpoint?.scope === input.scope ? input.checkpoint : undefined,
    (messages, summary) =>
      withNativeUsageScope({ workloadKind: 'context_compaction', projectId: input.projectId }, () =>
        input.compact(messages, summary),
      ),
    (checkpoint: ConversationCheckpoint) => input.save({ ...checkpoint, scope: input.scope }),
  );
  return {
    compacted: result.compacted,
    summarizedMessages: result.summarizedMessages,
    report: result.plan.report as ContextUsage,
  };
}

export async function prepareProjectContext(input: {
  projectId: string;
  model: ModelDescriptor;
  messages: readonly ProjectChatMessage[];
  fixedText: string;
  query?: string;
  scope: string;
  checkpoint?: ProjectContextCheckpoint;
  compact: (messages: readonly ConversationMessage[], summary: string) => Promise<string>;
  save: (checkpoint: ProjectContextCheckpoint) => Promise<void>;
}) {
  if (input.messages.some((m) => m.projectId !== input.projectId))
    throw new Error('project_chat_context_scope_mismatch');
  const plan = await prepareConversationContext(
    input.model,
    projectTranscript(input.messages),
    input.fixedText,
    input.checkpoint?.scope === input.scope ? input.checkpoint : undefined,
    (messages, summary) =>
      withNativeUsageScope({ workloadKind: 'context_compaction', projectId: input.projectId }, () =>
        input.compact(messages, summary),
      ),
    (checkpoint: ConversationCheckpoint) => input.save({ ...checkpoint, scope: input.scope }),
    input.query,
  );
  const tail = plan.selectedIndices
    ? plan.selectedIndices.map((i) => input.messages[i]!)
    : input.messages.slice(input.messages.length - plan.report.includedMessages);
  const summary: ProjectChatMessage[] = plan.report.compressedMessages
    ? [
        {
          id: '00000000-0000-4000-8000-000000000001',
          projectId: input.messages[0]!.projectId,
          role: 'assistant',
          status: 'complete',
          content: plan.history[0]!.text,
          actions: [],
          createdAt: plan.checkpoint!.createdAt,
          completedAt: plan.checkpoint!.createdAt,
        },
      ]
    : [];
  return { messages: [...summary, ...tail], report: plan.report as ContextUsage };
}
