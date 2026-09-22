import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ModelInvocationSchema } from '@gosu/contracts';
import { NativeTokenUsageSchema } from '../../../briefing-lab/src/context-usage';
import type { NativeUsageObservation } from '../../../briefing-lab/native-usage-observer';
import type { StoredModelUsageRow } from './local-database';
export const GLOBAL_USAGE_OWNER = '00000000-0000-4000-8000-000000000000';
const EventSchema = z
  .object({
    workloadKind: z.enum([
      'briefing_assistant',
      'briefing_summary',
      'paper_summary',
      'context_compaction',
      'daily_quote',
      'model_lab',
    ]),
    projectId: z.string().uuid().nullable(),
    invocation: ModelInvocationSchema,
    usage: NativeTokenUsageSchema.optional(),
    completedAt: z.string().datetime({ offset: true }),
    successful: z.boolean(),
  })
  .strict()
  .superRefine((e, ctx) => {
    const u = e.usage;
    if (!u) return;
    if (
      (u.inputTokens != null &&
        u.outputTokens != null &&
        (!Number.isSafeInteger(u.inputTokens + u.outputTokens) ||
          (u.totalTokens != null && u.totalTokens !== u.inputTokens + u.outputTokens))) ||
      (u.inputTokens != null &&
        u.cachedInputTokens != null &&
        u.cachedInputTokens > u.inputTokens) ||
      (u.outputTokens != null && u.reasoningTokens != null && u.reasoningTokens > u.outputTokens)
    )
      ctx.addIssue({ code: 'custom', message: 'usage_ledger_invalid_totals' });
  });
/** Token metadata only, independent of conversation deletion; never prompts or message content. */
export class NativeUsageLedger {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  private async read() {
    try {
      const raw = await readFile(this.path, 'utf8');
      if (raw.length > 80_000_000) throw new Error('usage_ledger_too_large');
      return z.array(EventSchema).max(100000).parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('usage_ledger_unreadable', { cause: error });
    }
  }
  record(raw: NativeUsageObservation) {
    const event = EventSchema.parse(raw);
    const operation = this.pending
      .catch(() => undefined)
      .then(async () => {
        const events = await this.read();
        const old = events.find((e) => e.invocation.invocationId === event.invocation.invocationId);
        if (old) {
          if (JSON.stringify(old) !== JSON.stringify(event))
            throw new Error('usage_ledger_identity_conflict');
          return;
        }
        if (events.length >= 100000) throw new Error('usage_ledger_capacity');
        events.push(event);
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const tmp = `${this.path}.${randomUUID()}.tmp`;
        try {
          await writeFile(tmp, JSON.stringify(events), { mode: 0o600, flag: 'wx' });
          await rename(tmp, this.path);
        } finally {
          await rm(tmp, { force: true });
        }
      });
    this.pending = operation;
    return operation;
  }
  async rows(): Promise<StoredModelUsageRow[]> {
    await this.pending;
    return (await this.read()).map((e) => {
      const u = e.usage;
      const known = u?.inputTokens != null && u?.outputTokens != null;
      const input = known ? u.inputTokens! : 0,
        output = known ? u.outputTokens! : 0,
        total = input + output;
      if (
        !Number.isSafeInteger(total) ||
        (known && u?.totalTokens != null && u.totalTokens !== total) ||
        (known && (u?.cachedInputTokens ?? 0) > input) ||
        (known && (u?.reasoningTokens ?? 0) > output)
      )
        throw new Error('usage_ledger_invalid_totals');
      return {
        invocationId: e.invocation.invocationId,
        providerId: e.invocation.providerId,
        threadId: `native:${e.invocation.invocationId}`,
        turnId: e.invocation.invocationId,
        resolvedModelId: e.invocation.resolvedModelId,
        startedAt: new Date(e.invocation.startedAt).toISOString(),
        coverage: known ? (e.successful ? 'exact' : 'partial') : 'unavailable',
        terminalStatus: e.successful ? 'completed' : 'failed',
        inputTokens: input,
        outputTokens: output,
        totalTokens: total,
        cachedReadTokens: known ? (u?.cachedInputTokens ?? null) : null,
        cachedWriteTokens: null,
        reasoningOutputTokens: known ? (u?.reasoningTokens ?? null) : null,
        workloadKind: e.workloadKind,
        projectId: e.projectId ?? GLOBAL_USAGE_OWNER,
        projectChatSessionId: null,
        projectChatAttemptId: null,
        lectureStudioId: null,
        lectureAttemptId: null,
        connectionKey: `${e.invocation.providerId}:native`,
        connectionLabel: `${e.invocation.providerId} · GOSU`,
        upstreamProviderId: null,
      };
    });
  }
}
