import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { BriefingAssistantSummary } from './briefing-assistant-summary';
import { initialWorkspace } from './fixtures';
import type { AnalysisResult } from './briefing-analysis-client';
import type { CalendarEvent } from './workspace-contracts';
import { mergeAnalyses } from './automatic-summary';
import { briefingCacheLabel } from './briefing-cache';

const routine = initialWorkspace().routines[0]!;
const analysis = {
  overview: '논문 설명은 이 카드의 목적이 아닙니다.',
  overviewByKind: { email: '오늘 회신이 필요한 메일이 있습니다.' },
  items: [
    {
      id: 'mail',
      summary: '내일 오후 5시까지 회신해야 합니다.',
      importance: 'high' as const,
      importanceReason: '명시적인 회신 기한',
      relevance: '',
      action: '참석 여부를 회신하세요.',
      evidenceQuote: '회신 요청',
      equationIds: [],
      figureIds: [],
      memorySuggestion: null,
    },
  ],
  invocation: { providerId: 'codex', model: 'gpt-6-astra', reasoning: 'medium' },
  memoryUsed: [],
  evidence: [],
} as AnalysisResult;
const calendar: CalendarEvent[] = [
  {
    id: 'event',
    fingerprint: 'f',
    calendarId: 'cal',
    title: '연구 미팅',
    start: '2026-09-09T01:00:00Z',
    end: '2026-09-09T02:00:00Z',
    allDay: false,
    timeZone: 'Asia/Seoul',
    location: '302호',
    notes: '',
    alarmMinutes: 10,
    recurring: false,
    hasAttendees: false,
  },
];

describe('AI assistant briefing summary', () => {
  it('opens an embedded live Calendar summary directly instead of scrolling inside the briefing', async () => {
    const postMessage = vi.fn(),
      onNavigate = vi.fn();
    vi.stubGlobal('window', { location: { search: '?embedded=gosu' }, parent: { postMessage } });
    let ui!: ReturnType<typeof create>;
    try {
      await act(() => {
        ui = create(
          <BriefingAssistantSummary
            routine={routine}
            calendar={calendar}
            progress={null}
            analysis={null}
            results={[]}
            onNavigate={onNavigate}
          />,
        );
      });
      await act(() => ui.root.findByProps({ title: '연구 미팅 상세로 이동' }).props.onClick());
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'gosu-briefing-open-item',
          target: { kind: 'calendar', id: 'event', start: calendar[0]!.start },
        },
        '*',
      );
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      if (ui) await act(() => ui.unmount());
      vi.unstubAllGlobals();
    }
  });
  it('renders restrained email action/overview emphasis and a bold calendar time without block markup in boxes', () => {
    const html = renderToStaticMarkup(
      <BriefingAssistantSummary
        routine={routine}
        calendar={calendar}
        progress={null}
        analysis={{
          ...analysis,
          overviewByKind: { email: '**회신 기한**이 있습니다.' },
          items: [
            { ...analysis.items[0]!, action: '**내일 오후 5시까지** 참석 여부를 회신하세요.' },
          ],
        }}
        results={[
          {
            kind: 'email',
            status: 'ready',
            fetchedAt: '',
            note: '',
            items: [
              {
                id: 'mail',
                kind: 'email',
                title: 'Reply',
                text: 'Source',
                source: 'Mail',
                details: [],
                readScope: 'mail-preview',
              },
            ],
          },
        ]}
      />,
    );
    expect(html).toContain('<strong>회신 기한</strong>');
    expect(html).toContain('<strong>내일 오후 5시까지</strong>');
    expect(html).toMatch(/<small><strong>[^<]*9월 9일[^<]*10:00<\/strong> · 302호<\/small>/);
    expect(html).not.toContain('<small><p>');
    expect(html).not.toContain('**');
  });
  it('makes each calendar/email/paper box a keyboard-accessible jump with the exact source identity', async () => {
    const onNavigate = vi.fn();
    let ui!: ReturnType<typeof create>;
    const common = { title: 'Same title', text: 'Source', source: 'Fixture', details: [] };
    await act(() => {
      ui = create(
        <BriefingAssistantSummary
          routine={routine}
          calendar={calendar}
          progress={null}
          navigationScope="view"
          onNavigate={onNavigate}
          analysis={{
            ...analysis,
            items: [
              ...analysis.items.map((item) => ({ ...item, importance: 'low' as const })),
              { ...analysis.items[0]!, id: 'paper', keywords: ['Optimization'] },
            ],
          }}
          results={[
            {
              kind: 'email',
              status: 'ready',
              fetchedAt: '',
              note: '',
              items: [{ ...common, id: 'mail', kind: 'email', readScope: 'mail-preview' }],
            },
            {
              kind: 'papers',
              status: 'ready',
              fetchedAt: '',
              note: '',
              items: [{ ...common, id: 'paper', kind: 'papers', readScope: 'abstract' }],
            },
          ]}
        />,
      );
    });
    const buttons = ui.root.findAllByType('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.props.type).toBe('button');
      expect(button.props['aria-controls']).toBeTruthy();
      await act(() => button.props.onClick());
    }
    expect(onNavigate.mock.calls.map((call) => call[0])).toEqual([
      { kind: 'papers', id: 'paper' },
      { kind: 'email', id: 'mail' },
      { kind: 'calendar', id: 'event' },
    ]);
    await act(() => ui.unmount());
  });
  it('shows no-LLM reuse only when every item is cached and no batch remains', () => {
    const cached: AnalysisResult = {
      ...analysis,
      cache: { feedbackProfileRevision: 3, reusedItemIds: ['mail'], generatedItemIds: [] },
    };
    const html = renderToStaticMarkup(
      <BriefingAssistantSummary
        routine={routine}
        results={[]}
        analysis={cached}
        calendar={[]}
        progress={null}
      />,
    );
    expect(html).toContain('캐시 재사용 · LLM 호출 없음');
    const pending = renderToStaticMarkup(
      <BriefingAssistantSummary
        routine={routine}
        results={[]}
        analysis={cached}
        calendar={[]}
        progress={{
          percent: 50,
          completed: 1,
          total: 2,
          kind: 'papers',
          range: '1/2',
          detail: '요약 중',
        }}
      />,
    );
    expect(pending).not.toContain('LLM 호출 없음');
    expect(briefingCacheLabel(analysis)).toBe('');
    const fresh: AnalysisResult = {
      ...analysis,
      items: [{ ...analysis.items[0]!, id: 'paper' }],
      cache: { feedbackProfileRevision: 3, reusedItemIds: [], generatedItemIds: ['paper'] },
    };
    const mixed = mergeAnalyses(cached, fresh);
    expect(briefingCacheLabel(mixed)).toBe('캐시 1건 재사용 · 1건 새로 요약');
    expect(briefingCacheLabel(mergeAnalyses(fresh, cached))).toBe(
      '캐시 1건 재사용 · 1건 새로 요약',
    );
    const twoCached = mergeAnalyses(cached, {
      ...fresh,
      cache: { feedbackProfileRevision: 3, reusedItemIds: ['paper'], generatedItemIds: [] },
    });
    expect(briefingCacheLabel(twoCached)).toBe('캐시 재사용 · LLM 호출 없음');
    expect(briefingCacheLabel(mergeAnalyses(twoCached, fresh))).not.toContain('LLM 호출 없음');
  });
  it('shows the source failure instead of a completed empty progress bar', () => {
    const html = renderToStaticMarkup(
      <BriefingAssistantSummary
        routine={routine}
        results={[]}
        analysis={null}
        calendar={[]}
        progress={{
          percent: 0,
          total: 0,
          completed: 0,
          kind: 'done',
          range: '0/0',
          detail: '자료 조회가 실패했습니다.',
        }}
      />,
    );
    expect(html).toContain('자료 조회가 실패했습니다.');
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('100%');
  });
  it('places practical email and calendar highlights before the detailed sources', () => {
    const html = renderToStaticMarkup(
      <BriefingAssistantSummary
        routine={routine}
        results={[
          {
            kind: 'email',
            status: 'ready',
            fetchedAt: '2026-09-09T00:00:00Z',
            items: [
              {
                id: 'mail',
                kind: 'email',
                title: '참석 여부 회신 요청',
                text: '회신 요청',
                source: 'Apple Mail',
                readScope: 'mail-preview',
                details: [],
              },
            ],
            note: 'mail',
          },
        ]}
        analysis={analysis}
        calendar={calendar}
        progress={{
          percent: 50,
          completed: 1,
          total: 2,
          kind: 'papers',
          range: '1/2',
          detail: '논문 준비 중',
        }}
      />,
    );
    expect(html.indexOf('오늘 먼저 확인할 내용')).toBeGreaterThanOrEqual(0);
    expect(html).toContain('오늘 회신이 필요한 메일이 있습니다.');
    expect(html).toContain('참석 여부를 회신하세요.');
    expect(html).toContain('연구 미팅');
    expect(html).toContain('이메일 요약을 먼저 끝낸 뒤 논문 요약을 이어갑니다.');
    expect(html).toContain('50%');
    expect(html).not.toContain('내 연구와의 연결');
  });
});
