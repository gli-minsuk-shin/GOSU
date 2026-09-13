import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { setUiLanguage } from '@gosu/ui/language';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mergeProjectToolActivityEvents,
  projectToolActivityRows,
  ProjectToolActivityView,
  type ProjectToolActivityEvent,
} from '../src/renderer/src/project-tool-activity-view';

const start: ProjectToolActivityEvent = {
  stage: 'tool_started',
  tool: 'read_workspace',
  callId: 'board-1',
  turnId: 'turn-1',
  occurredAt: '2026-09-08T10:00:00.000Z',
  activity: { section: 'board', target: 'FM-LM' },
};
const completed: ProjectToolActivityEvent = {
  ...start,
  stage: 'tool_completed',
  occurredAt: '2026-09-08T10:00:01.500Z',
  elapsedMs: 1_500,
  success: true,
  activity: { section: 'board', target: 'FM-LM', counts: [{ kind: 'tasks', value: 7 }] },
};
const renderers: ReactTestRenderer[] = [];
const markup = (events: readonly ProjectToolActivityEvent[]) =>
  renderToStaticMarkup(<ProjectToolActivityView events={events} />);

beforeEach(() => {
  setUiLanguage('en');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  await act(() => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
  });
  setUiLanguage('en');
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(events: readonly ProjectToolActivityEvent[], turnInFlight = true) {
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(<ProjectToolActivityView events={events} turnInFlight={turnInFlight} />);
  });
  renderers.push(renderer);
  return renderer;
}

describe('project tool activity lifecycle', () => {
  it('coalesces start/completion and duplicate delivery into one truthful row without mutating input', () => {
    const events = [start, completed, start, completed];
    const before = structuredClone(events);
    expect(projectToolActivityRows(events)).toEqual([
      expect.objectContaining({
        stage: 'tool_completed',
        success: true,
        elapsedMs: 1_500,
        activity: completed.activity,
      }),
    ]);
    const html = markup(events);
    expect(html.match(/data-call-id=/gu)).toHaveLength(1);
    expect(html).toContain('Read project Board');
    expect(html).toContain('FM-LM');
    expect(html).toContain('7 tasks');
    expect(html).toContain('Completed');
    expect(html).toContain('1.5s');
    expect(html).not.toContain('Running');
    expect(html).not.toContain('Receipt reviewed');
    expect(events).toEqual(before);
  });

  it('does not regress when completion arrives before its start and preserves metadata on both sides', () => {
    const end: ProjectToolActivityEvent = {
      ...completed,
      activity: { counts: [{ kind: 'tasks', value: 2 }] },
    };
    const rows = projectToolActivityRows([end, start]);
    expect(rows[0]).toMatchObject({
      stage: 'tool_completed',
      activity: { section: 'board', target: 'FM-LM', counts: [{ kind: 'tasks', value: 2 }] },
    });
    expect(markup([end, start])).not.toContain('Running');
  });

  it('keeps repeated tools and equal call identifiers in different turns distinct', () => {
    const rows = projectToolActivityRows([
      start,
      completed,
      { ...start, callId: 'board-2' },
      { ...start, turnId: 'turn-2' },
    ]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
  });

  it('retains at most 40 call groups and preserves event routing fields in the generic helper', () => {
    const events = Array.from({ length: 45 }, (_, index) => ({
      ...completed,
      callId: `call-${index}`,
      projectId: 'project-A',
      sessionId: 'session-A',
    }));
    const result = mergeProjectToolActivityEvents(events, {
      ...events[44]!,
      stage: 'tool_completed',
    });
    expect(projectToolActivityRows(result)).toHaveLength(40);
    expect(result[0]?.callId).toBe('call-5');
    expect(result.at(-1)).toMatchObject({
      projectId: 'project-A',
      sessionId: 'session-A',
      turnId: 'turn-1',
    });
  });

  it('labels a legacy one-sided completion without claiming verified success or fabricated timing', () => {
    const html = markup([{ stage: 'tool_completed', tool: 'read_workspace', callId: 'legacy' }]);
    expect(html).toContain('Result received');
    expect(html).toContain('No additional tool details were provided.');
    expect(html).not.toContain('Completed');
    expect(html).not.toContain('project-tool-activity-duration');
  });

  it('shows failure/error code and partial or zero counts without assuming the total result', () => {
    const html = markup([
      {
        ...completed,
        success: false,
        activity: {
          errorCode: 'research_notes_grant_inactive',
          counts: [{ kind: 'notes', value: 0 }],
          truncated: true,
        },
      },
    ]);
    expect(html).toContain('Failed');
    expect(html).toContain('research_notes_grant_inactive');
    expect(html).toContain('0 notes');
    expect(html).toContain('Partial result');
    expect(html).not.toContain('Completed');
  });

  it('shows safe target/query details without rendering untrusted text as markup or copying raw payloads', () => {
    const html = markup([
      {
        ...completed,
        tool: 'list_local_notes',
        activity: {
          query: '<script>alert(1)</script>' + 'q'.repeat(200),
          target: 'T'.repeat(300),
          offset: 40,
          limit: 500,
          counts: [{ kind: 'notes', value: 3 }],
        },
        rawArguments: { token: 'secret-token-not-for-display' },
      } as ProjectToolActivityEvent,
    ]);
    expect(html).toContain('Search Research Notes');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('secret-token-not-for-display');
    expect(html).not.toContain('T'.repeat(241));
    expect(html).toContain('Read offset');
    expect(html).toContain('Requested limit');
    expect(html).toContain('3 notes');
  });

  it('distinguishes summary, Board, Goal, note search and note reads without inferred purpose', () => {
    const events: ProjectToolActivityEvent[] = [
      { ...start, callId: 'a', activity: { section: 'summary' } },
      { ...start, callId: 'b', activity: { section: 'objective' } },
      { ...start, callId: 'c', tool: 'list_local_notes', activity: {} },
      {
        ...start,
        callId: 'd',
        tool: 'read_local_note',
        activity: { target: 'Experiment notes', counts: [{ kind: 'characters', value: 1_200 }] },
      },
    ];
    const html = markup(events);
    expect(html).toContain('Read project summary');
    expect(html).toContain('Read project Goal &amp; Metrics');
    expect(html).toContain('List Research Notes');
    expect(html).toContain('Read Research Note');
    expect(html).toContain('1200 characters');
  });

  it('honors English/Korean UI preference while preserving project names and provider-neutral accessibility', () => {
    setUiLanguage('ko');
    const html = renderToStaticMarkup(
      <ProjectToolActivityView events={[start, completed]} providerLabel="Codex" />,
    );
    expect(html).toContain('Codex 도구 실행 내역');
    expect(html).toContain('프로젝트 보드 읽기');
    expect(html).toContain('할 일 7개');
    expect(html).toContain('완료');
    expect(html).toContain('1.5초');
    expect(html).toContain('FM-LM');
    expect(html).not.toContain('Claude');
    setUiLanguage('en');
    expect(markup([completed])).toContain('Read project Board');
  });
});

describe('project tool activity interactions', () => {
  it('pins an old running call through 45 newer completed calls and unpins it after completion', async () => {
    let retained = [start];
    for (let index = 0; index < 45; index++) {
      retained = mergeProjectToolActivityEvents(retained, {
        ...completed,
        callId: `quick-${index}`,
      });
    }
    expect(projectToolActivityRows(retained)).toHaveLength(40);
    expect(projectToolActivityRows(retained)[0]).toMatchObject({
      callId: start.callId,
      stage: 'tool_started',
    });
    const renderer = await mount(retained);
    const visibleIds = () =>
      renderer.root.findAllByType('li').map((row) => row.props['data-call-id']);
    expect(visibleIds()).toEqual([
      'board-1',
      'quick-40',
      'quick-41',
      'quick-42',
      'quick-43',
      'quick-44',
    ]);
    retained = mergeProjectToolActivityEvents(retained, completed);
    await act(() => renderer.update(<ProjectToolActivityView events={retained} />));
    expect(visibleIds()).toEqual([
      'quick-39',
      'quick-40',
      'quick-41',
      'quick-42',
      'quick-43',
      'quick-44',
    ]);
    retained = mergeProjectToolActivityEvents(retained, { ...completed, callId: 'quick-45' });
    expect(projectToolActivityRows(retained)).toHaveLength(40);
    expect(projectToolActivityRows(retained).some((row) => row.callId === start.callId)).toBe(
      false,
    );
  });

  it('bounds more than six active calls while allowing all retained active calls to be expanded', async () => {
    const events = Array.from({ length: 9 }, (_, index) => ({
      ...start,
      callId: `active-${index}`,
    }));
    const renderer = await mount(events);
    expect(renderer.root.findAllByType('li').map((row) => row.props['data-call-id'])).toEqual([
      'active-0',
      'active-1',
      'active-2',
      'active-3',
      'active-4',
      'active-5',
    ]);
    await act(() => renderer.root.findByType('button').props.onClick());
    expect(renderer.root.findAllByType('li')).toHaveLength(9);
    expect(
      projectToolActivityRows(
        Array.from({ length: 45 }, (_, index) => ({ ...start, callId: `active-${index}` })),
      ),
    ).toHaveLength(40);
  });

  it('shows only the latest six calls by default and lets the user reveal retained calls', async () => {
    const events = Array.from({ length: 9 }, (_, index) => ({
      ...completed,
      callId: `call-${index}`,
    }));
    const renderer = await mount(events);
    expect(renderer.root.findAllByType('li')).toHaveLength(6);
    expect(renderer.root.findAllByType('li')[0]?.props['data-call-id']).toBe('call-3');
    const button = renderer.root.findByType('button');
    expect(button.children).toEqual(['Show all 9 calls']);
    await act(() => button.props.onClick());
    expect(renderer.root.findAllByType('li')).toHaveLength(9);
    expect(renderer.root.findByType('button').props['aria-expanded']).toBe(true);
  });

  it('updates elapsed time once per second only for an active call with a known start, then stops', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T10:00:02.000Z'));
    const renderer = await mount([start]);
    expect(JSON.stringify(renderer.toJSON())).toContain('2.0s');
    expect(
      renderer.root.findByProps({ className: 'project-tool-activity-duration' }).props[
        'aria-hidden'
      ],
    ).toBe(true);
    expect(renderer.root.findByType('time').props.dateTime).toBe(start.occurredAt);
    expect(vi.getTimerCount()).toBe(1);
    await act(() => vi.advanceTimersByTime(1_000));
    expect(JSON.stringify(renderer.toJSON())).toContain('3.0s');
    await act(() => renderer.update(<ProjectToolActivityView events={[start, completed]} />));
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('1.5s');
    expect(
      renderer.root.findByProps({ className: 'project-tool-activity-duration' }).props[
        'aria-hidden'
      ],
    ).toBeUndefined();
  });

  it('does not fabricate elapsed time for truncated start-only legacy history or an inactive turn', async () => {
    vi.useFakeTimers();
    const renderer = await mount([
      { stage: 'tool_started', tool: 'read_workspace', callId: 'legacy' },
    ]);
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('project-tool-activity-duration');
    await act(() =>
      renderer.update(<ProjectToolActivityView events={[start]} turnInFlight={false} />),
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('Result not received');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Running');
  });
});
