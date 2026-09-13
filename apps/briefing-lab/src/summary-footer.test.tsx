import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SummaryFooter } from './summary-footer';
import { BriefingHistoryItem } from './briefing-history-view';
import { mergeAnalyses } from './automatic-summary';
import type { AnalysisResult } from './briefing-analysis-client';
const provenance = {
  version: 1 as const,
  summarizedAt: '2026-09-09T00:00:00.000Z',
  sourceDigest: 'a'.repeat(64),
  contextDigest: 'b'.repeat(64),
  reused: true,
};
it('labels source publication separately from the preserved summary timestamp', () => {
  const html = renderToStaticMarkup(
    <SummaryFooter provenance={provenance} publishedAt="2026-09-01T00:00:00Z" />,
  );
  expect(html).toContain('최초 공개');
  expect(html).toContain('dateTime="2026-09-01T00:00:00Z"');
  expect(html).toContain('dateTime="2026-09-09T00:00:00.000Z"');
});
it('shows original Korean summary time and explicit refresh outside the collapsed paper', () => {
  const html = renderToStaticMarkup(
    <BriefingHistoryItem
      item={{
        id: 'p',
        title: 'Paper',
        kind: 'papers',
        readScope: 'abstract',
        summary: 'Saved',
        importance: 'high',
        relevance: '',
        provenance,
      }}
      onRefresh={async () => undefined}
    />,
  );
  expect(html).toContain('기존 요약');
  expect(html).toContain('오전 9:00');
  expect(html).toContain('다시 요약');
  expect(html.indexOf('briefing-summary-footer')).toBeGreaterThan(html.indexOf('</details>'));
  expect(html).not.toMatch(/<details[^>]* open/);
  expect(renderToStaticMarkup(<SummaryFooter savedAt="2026-09-09T00:00:00.000Z" />)).toContain(
    '요약 시각 미기록',
  );
});
it('never generates on render; disables repeated clicks and keeps a failed refresh visible', async () => {
  let reject!: (e: Error) => void;
  const onRefresh = vi.fn(
    () =>
      new Promise<void>((_, no) => {
        reject = no;
      }),
  );
  let ui!: ReturnType<typeof create>;
  await act(() => {
    ui = create(<SummaryFooter provenance={provenance} onRefresh={onRefresh} />);
  });
  expect(onRefresh).not.toHaveBeenCalled();
  await act(() => ui.root.findByType('button').props.onClick());
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(ui.root.findByType('button').props.disabled).toBe(true);
  await act(async () => {
    reject(new Error('원문을 찾을 수 없어 기존 요약을 유지했습니다.'));
  });
  expect(ui.root.findByProps({ role: 'alert' }).children.join('')).toContain('기존 요약');
  expect(ui.root.findByType('time').props.dateTime).toBe(provenance.summarizedAt);
  await act(() => ui.unmount());
});
it('labels a legacy saved snapshot without inventing a summarized-at time', () => {
  const html = renderToStaticMarkup(
    <SummaryFooter
      provenance={{
        version: 2,
        sourceDigest: null,
        contextDigest: null,
        summarizedAt: null,
        savedAt: '2026-09-08T00:00:00Z',
        reused: true,
        reuseBasis: 'paper-version',
        personalizationStale: true,
      }}
      compactRefresh
      onRefresh={async () => undefined}
    />,
  );
  expect(html).toContain('저장 · 요약 시각 미기록');
  expect(html).toContain('원문 재조회 없음');
  expect(html).toContain('요약 당시 기준');
  expect(html).toContain('aria-label="원문 다시 확인하고 재요약"');
});
it('retains each item timestamp while merging batches and replaces only refreshed provenance', () => {
  const a = {
    items: [{ id: 'a' }],
    evidence: [],
    provenance: { a: provenance },
  } as unknown as AnalysisResult;
  const b = {
    items: [{ id: 'b' }],
    evidence: [],
    provenance: { b: provenance },
  } as unknown as AnalysisResult;
  const merged = mergeAnalyses(a, b);
  expect(merged.provenance).toEqual({ a: provenance, b: provenance });
  expect(
    mergeAnalyses(merged, {
      ...a,
      provenance: { a: { ...provenance, reused: false, summarizedAt: '2026-09-10T00:00:00.000Z' } },
    }).provenance,
  ).toEqual({
    a: { ...provenance, reused: false, summarizedAt: '2026-09-10T00:00:00.000Z' },
    b: provenance,
  });
});
