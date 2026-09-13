import type { SavedPaper } from './paper-library-index';
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export type PaperDateRange = { from: string; to: string };
export type PaperDateFilters = { summary: PaperDateRange; published: PaperDateRange };
export const emptyPaperDates = (): PaperDateFilters => ({
  summary: { from: '', to: '' },
  published: { from: '', to: '' },
});
const validDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function paperDateError(filters: PaperDateFilters) {
  for (const key of ['summary', 'published'] as const) {
    const { from, to } = filters[key],
      label = key === 'summary' ? '요약일' : '공개일';
    if ([from, to].some((v) => v && !validDay(v))) return `${label}: 올바른 날짜를 입력해주세요.`;
    if (from && to && from > to) return `${label}: 시작일은 종료일보다 늦을 수 없습니다.`;
  }
  return '';
}
export function paperCalendarDay(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return dayFormatter.format(new Date(value));
}
export function matchesPaperDates(paper: SavedPaper, filters: PaperDateFilters) {
  if (paperDateError(filters)) return false;
  return (
    [
      ['summary', paper.item.provenance?.summarizedAt],
      ['published', paper.item.paperPublishedAt],
    ] as const
  ).every(([key, value]) => {
    const { from, to } = filters[key];
    if (!from && !to) return true;
    const date = paperCalendarDay(value);
    return date !== null && (!from || date >= from) && (!to || date <= to);
  });
}
