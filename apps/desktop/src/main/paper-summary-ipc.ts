import {
  PaperSummarySaveSchema,
  type PaperSummarySaveReceipt,
} from '../../../briefing-lab/src/paper-summary-contract';
export const PAPER_SUMMARY_SAVE_CHANNEL = 'gosu:paper-summary:save';
export function registerPaperSummaryIpc(
  register: (channel: string, handler: (input: unknown) => Promise<unknown>) => void,
  library: { save: (input: unknown, origin: 'GOSU') => Promise<PaperSummarySaveReceipt> },
) {
  register(PAPER_SUMMARY_SAVE_CHANNEL, async (raw) =>
    library.save(PaperSummarySaveSchema.parse(raw), 'GOSU'),
  );
}
