import { setUiLanguage } from '@gosu/ui/language';
import { readFileSync } from 'node:fs';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AI_WORK_ROTATE_MS,
  TitlebarAiStatus,
  aiWorkItems,
} from '../src/renderer/src/titlebar-ai-status';

const describeScope = (scope: string) =>
  ({
    assistant: 'AI assistant',
    briefing: 'Briefing',
    'project:p1:chat': 'FM-LM · Project chat',
    'project:p1:literature': 'FM-LM · Literature',
  })[scope] ?? null;
const label = (ui: ReactTestRenderer) =>
  ui.root
    .findByProps({ className: 'titlebar-ai-status-label' })
    .children.join('') as unknown as string;
const star = (ui: ReactTestRenderer) =>
  ui.root.findAllByProps({ className: 'sidebar-ai-star is-running' }).length
    ? 'running'
    : ui.root.findAllByProps({ className: 'sidebar-ai-star is-completed' }).length
      ? 'completed'
      : 'none';

describe('title bar AI status', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers();
    setUiLanguage('en');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setUiLanguage('en');
  });

  it('lists running work before finished work and drops scopes it cannot name', () => {
    const items = aiWorkItems(
      {
        briefing: { running: [], completed: true },
        'project:p1:chat': { running: ['a'], completed: false },
        'project:gone:chat': { running: ['b'], completed: false },
        assistant: { running: ['c'], completed: true },
        'project:p1:literature': { running: [], completed: false },
      },
      describeScope,
    );

    expect(items).toEqual([
      { scope: 'assistant', label: 'AI assistant', status: 'running' },
      { scope: 'project:p1:chat', label: 'FM-LM · Project chat', status: 'running' },
      { scope: 'briefing', label: 'Briefing', status: 'completed' },
    ]);
    expect(aiWorkItems({}, describeScope)).toEqual([]);
  });

  it('shows nothing at all while no AI is working', async () => {
    let ui!: ReactTestRenderer;
    await act(async () => {
      ui = create(<TitlebarAiStatus items={[]} onOpen={vi.fn()} />);
    });
    expect(ui.toJSON()).toBeNull();
  });

  it('turns the working star, and takes each job in turn every two seconds', async () => {
    const items = [
      { scope: 'assistant', label: 'AI assistant', status: 'running' as const },
      { scope: 'project:p1:chat', label: 'FM-LM · Project chat', status: 'running' as const },
    ];
    let ui!: ReactTestRenderer;
    await act(async () => {
      ui = create(<TitlebarAiStatus items={items} onOpen={vi.fn()} />);
    });
    expect(AI_WORK_ROTATE_MS).toBe(2_000);
    expect(star(ui)).toBe('running');
    expect(label(ui)).toBe('AI assistant');
    expect(JSON.stringify(ui.toJSON())).toContain('2 running');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(label(ui)).toBe('FM-LM · Project chat');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(label(ui)).toBe('AI assistant');
  });

  it('stands still for a single job and shows the finished star when nothing runs', async () => {
    let ui!: ReactTestRenderer;
    await act(async () => {
      ui = create(
        <TitlebarAiStatus
          items={[{ scope: 'briefing', label: 'Briefing', status: 'completed' }]}
          onOpen={vi.fn()}
        />,
      );
    });
    expect(star(ui)).toBe('completed');
    expect(label(ui)).toBe('Briefing');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(label(ui)).toBe('Briefing');
    expect(JSON.stringify(ui.toJSON())).not.toContain('running');
  });

  it('opens the job it is showing, not the first one', async () => {
    const onOpen = vi.fn();
    const items = [
      { scope: 'assistant', label: 'AI assistant', status: 'running' as const },
      { scope: 'project:p1:chat', label: 'FM-LM · Project chat', status: 'running' as const },
    ];
    let ui!: ReactTestRenderer;
    await act(async () => {
      ui = create(<TitlebarAiStatus items={items} onOpen={onOpen} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await act(async () => {
      ui.root.findByType('button').props.onClick();
    });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('project:p1:chat');
  });

  it('took the sync pill’s place in the header, and the queue count moved to Connections', () => {
    const app = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    const header = app.slice(
      app.indexOf('<header className="titlebar">'),
      app.indexOf('</header>'),
    );
    expect(header).toContain('<TitlebarAiStatus');
    expect(header).not.toContain('sync-pill');
    expect(app).toContain('pendingCount={pendingCount}');
    const runtimeCard = readFileSync(
      new URL('../src/renderer/src/ui-primitives.tsx', import.meta.url),
      'utf8',
    );
    expect(runtimeCard).toContain('{count} queued locally');
  });
});
