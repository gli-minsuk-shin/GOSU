import { createRoot } from 'react-dom/client';
import { EmailCalendarButton } from '../src/email-calendar';
import { defaultAssistantPreferences } from '@gosu/briefing-core';
import '../src/styles.css';
import '../src/workspace.css';
window.fetch = async (input) => {
  const path = String(input);
  const data = path.endsWith('/session')
    ? { token: 'fixture', clientToken: 'a'.repeat(64) }
    : path.endsWith('/todo/options')
      ? { authorized: false, lists: [], defaultListId: '', projects: [] }
      : path.endsWith('/assistant/settings/get')
        ? {
            preferences: {
              ...defaultAssistantPreferences(),
              calendarRead: true,
              calendarIds: ['c'],
            },
          }
        : path.endsWith('/calendar/catalog')
          ? { calendars: [{ id: 'c', name: '합성 캘린더', source: 'Fixture', writable: true }] }
          : null;
  if (!data) throw Error('Unexpected fixture operation; no writes or LLM calls allowed');
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
};
createRoot(document.getElementById('root')!).render(
  <main className="briefing-shell" style={{ padding: 24 }}>
    <h2>이메일 요약에서 준비된 작업 · 합성 화면</h2>
    <p>Apple 권한 없음 · 실제 저장/AI 호출 없음</p>
    <EmailCalendarButton
      routineId="r"
      title="자료 제출과 회의 일정"
      text="9월 20일 자료 제출, 10월 6일 오후 1시 회의"
      preparedActions={{
        task: {
          title: '검토 자료 제출',
          notes: '검토한 자료를 제출해주세요.',
          dueDate: '2026-09-20',
          dueAt: '2026-09-20T15:30:00+09:00',
          timeZone: 'Asia/Seoul',
          evidenceQuote: '자료 제출',
          deadlineQuote: '9월 20일',
          notice: '명시된 마감일입니다.',
        },
        event: {
          title: '자료 검토 회의',
          start: '2026-10-06T13:00:00+09:00',
          end: '2026-10-06T14:00:00+09:00',
          timeZone: 'Asia/Seoul',
          allDay: false,
          location: '본관 301호',
          notes: '자료 검토 회의',
          alarmMinutes: null,
          evidenceQuote: '10월 6일 오후 1시 회의',
          notice: '요약 시 준비했습니다.',
        },
      }}
    />
  </main>,
);
