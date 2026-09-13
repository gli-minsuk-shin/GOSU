import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefingAgendaDays } from './briefing-agenda-days';
import { upcomingTodos, type BriefingTodo } from './briefing-todos';
const todos: BriefingTodo[] = [
  {
    id: 'old',
    title: 'Overdue task',
    projectName: 'Project A',
    status: 'in_progress',
    dueDate: '2026-09-10',
  },
  {
    id: 'tomorrow',
    title: 'Tomorrow task',
    projectName: 'Project B',
    status: 'planned',
    dueDate: '2026-09-12',
  },
  {
    id: 'future',
    title: 'Future task',
    projectName: 'Project A',
    status: 'backlog',
    dueDate: '2026-09-20',
  },
  {
    id: 'done',
    title: 'Done task',
    projectName: 'Project B',
    status: 'done',
    dueDate: '2026-09-11',
  },
];
it('combines calendar and read-only todos in the same day columns with distinct styles and source labels', () => {
  const html = renderToStaticMarkup(
    <BriefingAgendaDays
      events={[
        {
          title: 'Meeting',
          start: '2026-09-11T09:00:00+09:00',
          end: '2026-09-11T10:00:00+09:00',
          allDay: false,
          timeZone: 'Asia/Seoul',
          location: '',
        },
      ]}
      referenceAt="2026-09-11T00:00:00Z"
      timeZone="Asia/Seoul"
      todos={todos}
    />,
  );
  expect(html).toContain('briefing-agenda-calendar');
  expect(html).toContain('briefing-agenda-todo');
  expect(html).toContain('Overdue task');
  expect(html).toContain('기한 지남');
  expect(html).toContain('Tomorrow task');
  expect(html).not.toContain('Future task');
  expect(html).not.toContain('Done task');
  expect(html).not.toContain('type="checkbox"');
});
it('limits visible tasks to six without mutating or completing the original records', () => {
  const many = Array.from({ length: 10 }, (_, n) => ({
    ...todos[0]!,
    id: String(n),
    title: `Task ${n}`,
  }));
  const html = renderToStaticMarkup(
    <BriefingAgendaDays
      events={[]}
      referenceAt="2026-09-11T00:00:00Z"
      timeZone="Asia/Seoul"
      todos={many}
    />,
  );
  expect(html.match(/class="briefing-agenda-todo"/g)).toHaveLength(6);
  expect(many).toHaveLength(10);
  expect(many[0]?.status).toBe('in_progress');
  expect(upcomingTodos(todos, '2026-09-12').map((t) => t.id)).toEqual(['old', 'tomorrow']);
});
