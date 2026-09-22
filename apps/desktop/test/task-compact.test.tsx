import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { setUiLanguage } from '@gosu/ui/language';

import { TaskDue, compactTaskDue } from '../src/renderer/src/task-compact';

afterEach(() => setUiLanguage('en'));

describe('compact task due label', () => {
  const today = '2026-09-21';
  it('names the days that matter and shortens every other date', () => {
    expect(compactTaskDue(undefined, undefined, today)).toBeNull();
    expect(compactTaskDue('2026-09-21', undefined, today)).toEqual({ state: 'today', days: 0 });
    expect(compactTaskDue('2026-09-22', undefined, today)).toEqual({ state: 'tomorrow', days: 1 });
    expect(compactTaskDue('2026-09-25', undefined, today)).toEqual({ state: 'upcoming', days: 4 });
    expect(compactTaskDue('2026-09-18', undefined, today)).toEqual({ state: 'overdue', days: -3 });
    // Month and year boundaries are whole calendar days, not 24-hour spans.
    expect(compactTaskDue('2026-10-01', undefined, '2026-09-30')).toMatchObject({ days: 1 });
    expect(compactTaskDue('2027-01-01', undefined, '2026-12-31')).toMatchObject({
      state: 'tomorrow',
    });
  });

  it('renders one short label, keeps the full date for hover and assistive technology', () => {
    const html = (dueDate: string, dueAt?: string) =>
      renderToStaticMarkup(<TaskDue dueDate={dueDate} dueAt={dueAt} today={today} />);
    expect(html('2026-09-21')).toContain('>Today<');
    expect(html('2026-09-21')).toContain('class="task-due today"');
    expect(html('2026-09-22')).toContain('>Tomorrow<');
    expect(html('2026-09-18')).toContain('>3d late<');
    expect(html('2026-09-18')).toContain('class="task-due overdue"');
    expect(html('2026-09-25')).toMatch(/>9\/25</u);
    expect(html('2027-02-03')).toMatch(/>2\/3\/27</u);
    expect(html('2026-09-25')).toContain('dateTime="2026-09-25"');
    expect(html('2026-09-25')).toContain('title="Due · 2026-09-25"');
    setUiLanguage('ko');
    expect(html('2026-09-21')).toContain('>오늘<');
    expect(html('2026-09-22')).toContain('>내일<');
    expect(html('2026-09-18')).toContain('>3일 지남<');
    expect(html('2026-09-25')).toMatch(/>9\. ?25\.?</u);
  });

  it('shows the time of a timed task next to the day', () => {
    const at = new Date(2026, 8, 22, 21, 0).toISOString();
    const html = renderToStaticMarkup(<TaskDue dueDate="2026-09-22" dueAt={at} today={today} />);
    expect(html).toMatch(/>Tomorrow 9:00\sPM</u);
  });

  it('renders nothing without a due date', () => {
    expect(renderToStaticMarkup(<TaskDue dueDate={undefined} dueAt={undefined} />)).toBe('');
  });
});
