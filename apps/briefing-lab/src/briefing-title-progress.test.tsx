import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefingGenerationProgress } from './briefing-generation-progress';
import type * as ReactDom from 'react-dom';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { sourceRequest } from './live-client';

const portals: { node: ReactNode; target: unknown }[] = [];
vi.mock('react-dom', async (original) => ({
  ...(await original<typeof ReactDom>()),
  // react-test-renderer cannot mount portals; record where the progress is sent instead.
  createPortal: (node: ReactNode, target: unknown) => {
    portals.push({ node, target });
    return null;
  },
}));
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
const { BriefingGenerationControls } = await import('./briefing-generation-controls');

afterEach(() => {
  portals.splice(0);
  vi.unstubAllGlobals();
});

it('renders the running progress beside the page title instead of below the controls', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: null,
    scheduleError: null,
    job: {
      id: '11111111-1111-4111-8111-111111111111',
      routineId: 'r',
      runId: null,
      state: 'running',
      detail: '요약 중',
      newCount: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
      progress: { stage: 'summarize', completed: 0, total: 6 },
    },
  });
  const slot = { id: 'title-slot' } as unknown as HTMLElement;
  let ui!: ReactTestRenderer;
  await act(async () => {
    ui = create(<BriefingGenerationControls routineId="r" progressSlot={slot} />);
  });
  expect(portals.at(-1)?.target).toBe(slot);
  expect(
    ui.root.findAll((node) => node.props.className === 'briefing-generation-progress'),
  ).toEqual([]);
  act(() => ui.unmount());

  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  // The title row is as tall as the 34px button row, and status boxes shrink before they wrap.
  expect(css).toMatch(/\.briefing-title-row \{[^}]*min-height: 34px;/);
  expect(css).toMatch(/\.briefing-title-progress \{[^}]*flex-wrap: nowrap;[^}]*flex: 1 1 0;/);
  // The opened detail floats over the page instead of growing the header.
  expect(css).toMatch(
    /\.briefing-title-progress \.briefing-progress-detail \{[^}]*position: absolute;[^}]*z-index: 30;/,
  );
  const app = readFileSync(new URL('./briefing-app.tsx', import.meta.url), 'utf8');
  expect(app).toContain('className="briefing-title-progress" ref={setTitleProgressSlot}');
  expect(app).toContain('progressSlot={titleProgressSlot}');
  const workspace = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  // Without a progress box or alert inside, the controls no longer reserve a 420px column.
  expect(workspace).toContain(".briefing-generation-controls > [role='alert']");
});

it('puts the collapsed run warning and a paused schedule beside the title too', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    intervalHours: 4,
    nextDueAt: null,
    scheduleError: '설정 또는 권한 확인이 필요해 자동 생성을 일시 중지했습니다.',
    job: {
      id: '11111111-1111-4111-8111-111111111111',
      routineId: 'r',
      runId: null,
      state: 'complete',
      detail: '3개 추가',
      newCount: 3,
      summaryFailures: 2,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: '논문 1–6번째 요약 실패: AI 서버에 연결하지 못했습니다.',
    },
  });
  const slot = { id: 'title-slot' } as unknown as HTMLElement;
  let ui!: ReactTestRenderer;
  await act(async () => {
    ui = create(<BriefingGenerationControls routineId="r" progressSlot={slot} />);
  });
  const classes = portals
    .filter((portal) => portal.target === slot)
    .map((portal) => (portal.node as { props: { className: string } }).props.className);
  expect(classes).toEqual(
    expect.arrayContaining(['briefing-generation-job-error', 'briefing-generation-schedule-error']),
  );
  // Nothing of it stays under the buttons, so the header keeps a single row.
  expect(
    ui.root.findAll((node) =>
      String(node.props.className ?? '').includes('briefing-generation-alert'),
    ),
  ).toEqual([]);
  act(() => ui.unmount());
});

it('keeps the progress line inside its box when the title line is narrow', () => {
  // At a body of 820px or less the counter and elapsed time did not shrink and were not clipped, so
  // "11/57개 저장 경과 2분 46초" ran up to 150px past the box, under the guidance and collapse buttons.
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  const rule = (selector: string) =>
    css
      .split(`${selector} {`)
      .slice(1)
      .map((part) => part.split('}')[0])
      .join(' ');
  const summary = rule('.briefing-title-progress .briefing-generation-progress > summary');
  expect(summary).toContain('overflow: hidden');
  expect(summary).toContain('white-space: nowrap');
  const parts = rule(
    '.briefing-title-progress .briefing-generation-progress > summary > :is(strong, span)',
  );
  expect(parts).toContain('min-width: 0');
  expect(parts).toContain('text-overflow: ellipsis');
  expect(
    rule(
      '.briefing-title-progress .briefing-generation-progress > summary > .briefing-progress-chevron',
    ),
  ).toContain('flex: 0 0 auto');
  expect(rule('.briefing-title-progress > .briefing-generation-alert')).toContain('flex-shrink: 3');
  expect(rule('.briefing-title-progress > .briefing-generation-alert')).toContain(
    'min-width: 62px',
  );
  expect(rule('.briefing-title-progress .briefing-generation-alert > summary::before')).toContain(
    "content: '!'",
  );
  // The saved count is the last thing a narrow progress line gives up.
  expect(
    rule(
      '.briefing-title-progress .briefing-generation-progress > summary > span:not(:last-of-type)',
    ),
  ).toContain('flex-shrink: 0');
  // The status line is never wider than the title column it sits in.
  expect(rule('.briefing-title-progress')).toContain('min-width: min(160px, 100%)');
  // What a narrow box cuts short stays readable on hover.
  const html = renderToStaticMarkup(
    createElement(BriefingGenerationProgress, {
      job: {
        id: '11111111-1111-4111-8111-111111111111',
        routineId: 'r',
        runId: null,
        state: 'running',
        detail: '이메일 요약 중',
        newCount: 11,
        startedAt: new Date(Date.now() - 166000).toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
        progress: { stage: 'summarize', completed: 11, total: 57 },
      },
    }),
  );
  expect(html).toMatch(/<summary[^>]*title="[^"]*11\/57개 저장[^"]*경과 2분 4\d초"/);
});

it('shows the opened run warning: its text is not a paragraph, which the compact header hides', () => {
  // 2026-09-21: "error 가 떠도 … 클릭해도 안보여줌". The reason was a <p> inside the main header,
  // and workspace.css hides every <p> there; no rule gave it a display back, so opening the
  // collapsed warning showed nothing. Measured with the real CSS: <p> display none and 0px high, the
  // div 420×76px with three lines.
  const flat = (file: string) =>
    readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\s+/g, ' ');
  const workspace = flat('./workspace.css'),
    styles = flat('./styles.css');
  // The trap is still there, so nothing in the header may rely on a bare <p>.
  expect(workspace).toContain(
    '.briefing-main-header .briefing-breadcrumb, .briefing-main-header p { display: none; }',
  );
  const controls = readFileSync(
    new URL('./briefing-generation-controls.tsx', import.meta.url),
    'utf8',
  );
  const alert = controls.slice(controls.indexOf('function BriefingCollapsibleAlert'));
  expect(alert).toContain('<div className="briefing-generation-alert-detail">{detail}</div>');
  expect(alert).not.toMatch(/<p[\s>]/u);
  // Both places the alert can render (beside the title, under the controls) style that element.
  expect(styles).not.toContain('.briefing-generation-alert > p');
  const panel = styles
    .split(
      '.briefing-title-progress .briefing-generation-alert > .briefing-generation-alert-detail {',
    )[1]!
    .split('}')[0]!;
  expect(panel).toContain('position: absolute');
  const detail = styles
    .split('.briefing-generation-alert > .briefing-generation-alert-detail {')
    .at(-1)!
    .split('}')[0]!;
  // One recorded warning per line.
  expect(detail).toContain('white-space: pre-wrap');
  expect(detail).toContain('overflow-wrap: anywhere');
  const service = readFileSync(new URL('../live-source-service.ts', import.meta.url), 'utf8');
  expect(service).toContain("warnings.join('\\n').slice(0, 1000)");
});
