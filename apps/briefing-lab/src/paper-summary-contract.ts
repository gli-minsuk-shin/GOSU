import { z } from 'zod';
import { PaperInsightSchema } from './briefing-intelligence';
import { PaperBibliographySchema } from './paper-bibliography';

export const VerifiedPaperSummarySchema = z.object({
  sourceId: z.string(),
  readScope: z.string(),
  publishedAt: z.string().optional(),
  bibliography: PaperBibliographySchema.optional(),
  summarizedAt: z.string().datetime(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  contextDigest: z.string().regex(/^[a-f0-9]{64}$/),
  insight: PaperInsightSchema,
  equations: z.array(z.object({ latex: z.string(), explanation: z.string() })).max(4),
  figures: z
    .array(
      z.object({
        id: z.string(),
        caption: z.string(),
        assetUrl: z.string(),
        imageData: z.string().optional(),
      }),
    )
    .max(2),
});

export const PAPER_SAVE_QUESTION = '이 논문 분석을 Briefing Lab 논문 요약 보관함에 추가할까요?';
export const PAPER_SAVE_MARKER = '<!-- gosu-paper-save-offer -->';
export const PaperSummaryCandidateSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    question: z.string().trim().min(1).max(12000),
    markdown: z.string().trim().min(1).max(64000),
    sourceUrls: z.array(z.string().url().max(2000)).max(12),
  })
  .strict();
export type PaperSummaryCandidate = z.infer<typeof PaperSummaryCandidateSchema>;
export const PaperSummarySaveSchema = z
  .object({ candidate: PaperSummaryCandidateSchema, confirmed: z.literal(true) })
  .strict();
export type PaperSummarySaveReceipt = { id: string; savedAt: string; alreadySaved: boolean };
export type PaperSummaryRecord = PaperSummaryCandidate & {
  paper?: z.infer<typeof VerifiedPaperSummarySchema> | undefined;
  id: string;
  savedAt: string;
  origin: 'GOSU' | 'Model Lab' | 'Briefing Lab';
};
export const PaperSummaryRecordSchema = PaperSummaryCandidateSchema.extend({
  paper: VerifiedPaperSummarySchema.optional(),
  id: z.string().regex(/^[a-f0-9]{64}$/),
  savedAt: z.string().datetime(),
  origin: z.enum(['GOSU', 'Model Lab', 'Briefing Lab']),
}).strict();

export function paperSummaryCandidate(
  question: string,
  answer: string,
  references: readonly { title: string; url: string }[] = [],
): PaperSummaryCandidate | null {
  const cited = references.filter(
    (ref) => safePaperLink(ref.url) && (answer.includes(ref.title) || question.includes(ref.url)),
  );
  // An invitation never authorizes saving. Source text can at most cause an extra visible offer.
  if (
    !/(?:논문|문헌|arxiv|doi\.org|\bpapers?\b|publications?)/iu.test(question) &&
    !/https:\/\/(?:arxiv\.org\/(?:abs|html)|doi\.org\/)/iu.test(answer) &&
    !cited.length &&
    !answer.includes(PAPER_SAVE_QUESTION) &&
    !answer.includes(PAPER_SAVE_MARKER)
  )
    return null;
  const markdown = answer.replace(PAPER_SAVE_QUESTION, '').replaceAll(PAPER_SAVE_MARKER, '').trim();
  if (!question.trim() || !markdown.length || markdown.length > 64000 || question.length > 12000)
    return null;
  const links = [...markdown.matchAll(/\[([^\]\n]{1,240})\]\((https:\/\/[^\s)]+)\)/g)];
  const urls = [
    ...new Set(
      [
        ...cited.map((ref) => ref.url),
        ...links.map((m) => m[2]!),
        ...question.matchAll(/https:\/\/[^\s)\]>]+/g),
      ].map((value) => (typeof value === 'string' ? value : value[0])),
    ),
  ]
    .filter(safePaperLink)
    .slice(0, 12);
  const title =
    cited.length === 1
      ? cited[0]!.title.slice(0, 240)
      : links.length === 1 && links[0]![1]!.length > 8
        ? links[0]![1]!
        : (markdown.match(/^#{1,2}\s+(?!연구 질문|강점|약점|방법|보고된)([^\n]{3,200})/m)?.[1] ??
          `논문 분석 · ${question.trim().slice(0, 180)}`);
  if (!urls.length) return null;
  return { title, question: question.trim(), markdown, sourceUrls: urls };
}
export function safePaperLink(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(
        u.hostname,
      ) &&
      !u.hostname.endsWith('.local')
    );
  } catch {
    return false;
  }
}
export function paperSaveReply(value: string, allowBareYes = true): 'save' | 'decline' | null {
  const s = value
    .normalize('NFKC')
    .trim()
    .replace(/[.!。！]+$/, '')
    .trim();
  if (
    /^(?:저장하지\s*마(?:세요)?|추가하지\s*마(?:세요)?|넣지\s*마|아니(?:요)?|나중에|no)$/i.test(s)
  )
    return 'decline';
  if (
    /^(?:(?:이\s*)?논문(?:\s*분석|\s*요약)?(?:을|를)?\s*)?(?:(?:Briefing\s*Lab\s*)?(?:논문\s*요약\s*)?보관함에\s*)(?:추가|저장)(?:해\s*줘|해\s*주세요|해주세요|해줘|해)?$/i.test(
      s,
    )
  )
    return 'save';
  if (
    allowBareYes &&
    /^(?:네|예|응|좋아|yes|save it|추가해\s*줘|저장해\s*줘|넣어\s*줘|추가해\s*주세요|저장해\s*주세요)$/i.test(
      s,
    )
  )
    return 'save';
  return null;
}
