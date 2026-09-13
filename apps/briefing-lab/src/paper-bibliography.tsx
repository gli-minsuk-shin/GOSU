import { z } from 'zod';
export const PaperBibliographySchema = z.object({
  authors: z.array(z.string().max(500)).max(30),
  venue: z.string().max(1000).optional(),
  source: z.string().max(100),
});
export type PaperBibliography = z.infer<typeof PaperBibliographySchema>;
export function PaperByline({
  publishedAt,
  bibliography,
}: {
  publishedAt?: string | undefined;
  bibliography?: PaperBibliography | undefined;
}) {
  const date =
    publishedAt && Number.isFinite(Date.parse(publishedAt))
      ? new Intl.DateTimeFormat('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          timeZone: 'Asia/Seoul',
        }).format(new Date(publishedAt))
      : '공개일 미확인';
  const venue =
    bibliography?.venue ||
    (bibliography?.source === 'arXiv' ? 'arXiv · 프리프린트' : '게재처 미확인');
  return (
    <span className="briefing-paper-byline" title={`${date} · ${venue}`}>
      {publishedAt && Number.isFinite(Date.parse(publishedAt)) ? (
        <time dateTime={publishedAt}>{date}</time>
      ) : (
        <span>{date}</span>
      )}
      <span> · {venue}</span>
    </span>
  );
}
export function PaperAuthors({ bibliography }: { bibliography?: PaperBibliography | undefined }) {
  return (
    <p className="briefing-paper-authors">
      <strong>저자</strong> ·{' '}
      {bibliography?.authors.length ? bibliography.authors.join(', ') : '저자 정보 미확인'}
    </p>
  );
}
export function newestSummaryFirst<T>(items: readonly T[], date: (item: T) => string | undefined) {
  const time = (i: T) => {
    const n = Date.parse(date(i) ?? '');
    return Number.isFinite(n) ? n : 0;
  };
  return [...items].sort((a, b) => time(b) - time(a));
}
