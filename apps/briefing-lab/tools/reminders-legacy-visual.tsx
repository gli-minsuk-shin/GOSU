import { createRoot } from 'react-dom/client';
import { ReminderSettings } from '../src/reminder-settings';
import { BriefingTodoButton } from '../src/briefing-todo-button';
import { recoverLegacyEmailTask } from '../legacy-email-task';
import '../src/styles.css';
import '../src/workspace.css';
let authorized = false,
  reminderDefaults = { enabled: false, listId: '' };
window.fetch = async (input, init) => {
  const url = String(input);
  let result: unknown;
  if (url.endsWith('/session')) result = { token: 'fixture', clientToken: 'a'.repeat(64) };
  else if (url.endsWith('/todo/preferences')) {
    const value = JSON.parse(String(init?.body));
    reminderDefaults = { enabled: value.enabled, listId: value.listId };
    result = reminderDefaults;
  } else if (url.endsWith('/todo/options') || url.endsWith('/todo/authorize')) {
    if (url.endsWith('/todo/authorize')) authorized = true;
    result = {
      authorized,
      reminderDefaults,
      projects: [],
      lists: authorized
        ? [{ id: 'fixture-list', name: '합성 기본 목록', source: 'iCloud', writable: true }]
        : [],
      defaultListId: 'fixture-list',
    };
  } else throw Error('No real writes or AI calls in this fixture');
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
};
const title = '2027-1학기 설문 (회신기한: 9/21일 (월) 12:00)';
const task = recoverLegacyEmailTask({
  title,
  summary: '9월 21일 12시까지 회신해주세요.',
  receivedAt: '2026-09-14T00:00:00Z',
  timeZone: 'Asia/Seoul',
});
createRoot(document.getElementById('root')!).render(
  <main className="briefing-shell" style={{ padding: 24, maxWidth: 850, margin: 'auto' }}>
    <h2>합성 이메일 · 이전 요약의 기한 복원</h2>
    <p>실제 이메일·미리 알림 작성이나 AI 호출은 없습니다.</p>
    <ReminderSettings routineId="r" />
    <hr />
    <BriefingTodoButton
      routineId="r"
      title={title}
      text="9월 21일 12시까지 회신"
      preparedTask={task}
    />
  </main>,
);
