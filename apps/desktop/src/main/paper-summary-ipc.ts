import {
  PaperSummarySaveSchema,
  type PaperSummaryRecord,
  type PaperSummarySaveReceipt,
} from '../../../briefing-lab/src/paper-summary-contract';
import {
  ImportPaperSummariesInputSchema,
  PAPER_LIBRARY_IPC_CHANNELS,
  type ImportPaperSummariesReceipt,
  type PaperLibraryList,
} from '../shared/paper-library-contracts';
import { LiteratureServiceError } from './literature-service';
import { importPaperSummariesToLiterature, paperLibraryEntries } from './paper-library-literature';

export const PAPER_SUMMARY_SAVE_CHANNEL = 'gosu:paper-summary:save';

/** Codes the Literature view can explain; nothing from the sealed library leaks as raw text. */
export type PaperLibraryIpcErrorCode =
  | 'invalid_paper_library_input'
  | 'paper_library_unavailable'
  | 'literature_unavailable'
  | LiteratureServiceError['code'];
export type PaperLibraryIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: PaperLibraryIpcErrorCode }> }>;

type PaperLibrary = Readonly<{
  save: (input: unknown, origin: 'GOSU') => Promise<PaperSummarySaveReceipt>;
  list?: () => Promise<readonly PaperSummaryRecord[]>;
}>;
type LibraryLiterature = Parameters<typeof importPaperSummariesToLiterature>[0]['literature'];

export function registerPaperSummaryIpc(
  register: (channel: string, handler: (input: unknown) => Promise<unknown>) => void,
  library: PaperLibrary,
  literature?: LibraryLiterature,
) {
  register(PAPER_SUMMARY_SAVE_CHANNEL, async (raw) =>
    library.save(PaperSummarySaveSchema.parse(raw), 'GOSU'),
  );
  const list = library.list?.bind(library);
  register(
    PAPER_LIBRARY_IPC_CHANNELS.list,
    async (): Promise<PaperLibraryIpcResult<PaperLibraryList>> => {
      if (!list) return { ok: false, error: { code: 'paper_library_unavailable' } };
      try {
        return { ok: true, value: paperLibraryEntries(await list()) };
      } catch {
        // The library is sealed with the Briefing key; a locked keychain or a damaged file ends here.
        return { ok: false, error: { code: 'paper_library_unavailable' } };
      }
    },
  );
  register(
    PAPER_LIBRARY_IPC_CHANNELS.importToLiterature,
    async (raw): Promise<PaperLibraryIpcResult<ImportPaperSummariesReceipt>> => {
      const parsed = ImportPaperSummariesInputSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: { code: 'invalid_paper_library_input' } };
      if (!list) return { ok: false, error: { code: 'paper_library_unavailable' } };
      if (!literature) return { ok: false, error: { code: 'literature_unavailable' } };
      let records: readonly PaperSummaryRecord[];
      try {
        records = await list();
      } catch {
        return { ok: false, error: { code: 'paper_library_unavailable' } };
      }
      try {
        return {
          ok: true,
          value: await importPaperSummariesToLiterature(
            { library: { list: async () => records }, literature },
            parsed.data,
          ),
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: error instanceof LiteratureServiceError ? error.code : 'literature_unavailable',
          },
        };
      }
    },
  );
}
