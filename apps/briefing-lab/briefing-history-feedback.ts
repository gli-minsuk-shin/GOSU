import { z } from 'zod';
import type { BriefingMemoryStore } from './briefing-memory-store';
import type { BriefingWorkspaceStore } from './briefing-workspace-store';
import type { LiveItem } from './src/live-types';
import { briefingClientHash } from './briefing-client-context';
import { curateHistoryTags } from './briefing-paper-tags';

export async function saveHistoryFeedback(
  raw: unknown,
  workspace: BriefingWorkspaceStore,
  memory: BriefingMemoryStore,
  consent: (message: string, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
) {
  const input = z
    .object({
      routineId: z.string().min(1).max(128),
      historyId: z.string().min(1).max(128),
      itemId: z.string().min(1).max(160),
      decision: z.enum(['important', 'not-interested']).nullable(),
    })
    .strict()
    .parse(raw);
  if (!briefingClientHash()) throw new Error('assistant_client_required');
  const profile = await workspace.profile(input.routineId);
  if (profile && !workspace.owns(profile)) throw new Error('assistant_client_required');
  const history = curateHistoryTags(await workspace.summaryHistory(input.routineId)).find(
    (h) => h.id === input.historyId && h.kind === 'briefing',
  );
  const saved = history?.items.find((i) => i.id === input.itemId);
  if (!history || !saved || saved.kind === 'weather')
    throw new Error('briefing_history_item_missing');
  if (
    !profile ||
    workspace.requiresPerRequestConfirmation(profile) ||
    (history.private &&
      !(await workspace.canPrivateAi(input.routineId, profile.preferences.providerId)))
  )
    await consent(
      '저장된 브리핑 선호\n이 항목의 제목·키워드와 중요함/관심 없음 선택을 로컬 암호화 기억에 저장합니다. 원본 메일을 다시 읽거나 LLM에 전송하지 않습니다.',
      signal,
    );
  const guard = async () => {
    if (signal.aborted) throw new Error('source_cancelled');
    if (JSON.stringify(await workspace.profile(input.routineId)) !== JSON.stringify(profile))
      throw new Error('assistant_settings_changed');
    if (profile && !workspace.owns(profile)) throw new Error('assistant_client_required');
  };
  await guard();
  const kind = saved.kind ?? (saved.readScope.startsWith('mail') ? 'email' : 'papers');
  const item: LiveItem = {
    id: saved.id,
    kind,
    title: saved.title,
    text: '',
    source: '저장된 브리핑',
    readScope: kind === 'email' ? 'mail-metadata' : 'paper-metadata',
    details: [],
    ...(saved.sourceUrl ? { sourceUrl: saved.sourceUrl } : {}),
  };
  await memory.feedback(
    input.routineId,
    item,
    input.decision,
    signal,
    guard,
    saved.tags ?? saved.keywords ?? [],
    history.private,
  );
  return {
    decision: input.decision,
    feedbackProfileRevision: (await memory.status(input.routineId)).feedbackProfileRevision,
  };
}
