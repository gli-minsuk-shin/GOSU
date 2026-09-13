import { z } from 'zod';
const routineId = z.string().min(1).max(128);
export const HistoryRemovalTargetSchema = z.union([
  z
    .object({ routineId, historyId: z.string().min(1).max(128), confirmed: z.literal(true) })
    .strict(),
  z.object({ routineId, runId: z.string().uuid(), confirmed: z.literal(true) }).strict(),
]);
export type HistoryRemovalTarget =
  { routineId: string; historyId: string } | { routineId: string; runId: string };
export const HistoryRestoreSchema = z.object({ routineId, deletionId: z.string().uuid() }).strict();
export const RemovedBriefingSchema = z
  .object({
    id: z.string().uuid(),
    routineId,
    historyId: z.string().min(1).max(128),
    runId: z.string().uuid().nullable(),
    createdAt: z.string(),
    deletedAt: z.string().datetime(),
    restoredAt: z.string().datetime().optional(),
    routineName: z.string().max(160),
    timeZone: z.string().max(100).default('Asia/Seoul'),
  })
  .strict();
export type RemovedBriefing = z.infer<typeof RemovedBriefingSchema>;
export const HistoryRemovalReceiptSchema = z
  .object({
    deletionId: z.string().uuid(),
    routineId,
    runId: z.string().uuid().nullable(),
    historyIds: z.array(z.string().min(1).max(128)).max(10000),
  })
  .strict();
export type HistoryRemovalReceipt = z.infer<typeof HistoryRemovalReceiptSchema>;
export const BRIEFING_HISTORY_CHANGED = 'briefing-history-changed';
export function announceHistoryChange(receipt: HistoryRemovalReceipt, restored = false) {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined')
    window.dispatchEvent?.(
      new CustomEvent(BRIEFING_HISTORY_CHANGED, { detail: { ...receipt, restored } }),
    );
}
export const historyGroupKey = (
  routineId: string,
  runId: string | null | undefined,
  historyId: string,
) => JSON.stringify([routineId, runId ?? historyId]);
export const removedHistoryKeys = (removed: readonly RemovedBriefing[]) =>
  new Set(
    removed
      .filter((r) => !r.restoredAt)
      .map((r) => historyGroupKey(r.routineId, r.runId, r.historyId)),
  );
