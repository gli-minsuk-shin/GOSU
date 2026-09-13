import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { CalendarEventEditor } from '../src/calendar-event-editor';
import { initialEvent } from '../src/calendar-dates';
import { EmailBriefingDisclosure } from '../src/briefing-insight-card';
import { defaultAssistantPreferences } from '@gosu/briefing-core';
import '../src/styles.css';
import '../src/workspace.css';
const calls: string[] = [];
let accessAuthorized = !new URLSearchParams(location.search).has('permission');
Object.assign(window, { mailActionCalls: calls });
window.fetch = async (input) => {
  const path = String(input);
  calls.push(path);
  if (path.endsWith('/calendar/catalog') && !accessAuthorized)
    return new Response(JSON.stringify({ error: 'macOS Calendar 접근을 허용해주세요.' }), {
      status: 403,
    });
  let data: unknown;
  if (path.endsWith('/session')) data = { token: 'fixture', clientToken: 'a'.repeat(64) };
  else if (path.endsWith('/settings/get'))
    data = {
      preferences: {
        ...defaultAssistantPreferences(),
        calendarRead: true,
        calendarIds: ['fixture'],
      },
    };
  else if (path.endsWith('/calendar/catalog'))
    data = {
      calendars: [
        { id: 'holiday', name: '구독 공휴일', source: 'Read-only', writable: false, color: '#888' },
        {
          id: 'fixture',
          name: '검증용 Calendar',
          source: 'Synthetic',
          writable: true,
          color: '#527d0b',
        },
      ],
    };
  else if (path.endsWith('/calendar/authorize')) {
    accessAuthorized = true;
    data = { authorized: true };
  } else if (path.endsWith('/calendar/prepare')) data = { action: { id: 'fixture' } };
  else if (path.endsWith('/calendar/apply')) data = { id: 'fixture-event' };
  else throw Error('Unexpected fixture request: ' + path);
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
};
const copies = ['work', 'personal'].map((id) => ({
  id,
  title: '워크숍 참석 회신',
  receivedAt: '2026-09-11T00:00:00Z',
  account: { id, name: 'Google', addresses: [`${id}@example.test`] },
}));
function NewCalendarFixture() {
  const deleting = new URLSearchParams(location.search).has('delete');
  const initial = {
    ...initialEvent('Asia/Seoul', deleting ? 'fixture' : 'holiday', '2026-09-12T10:00'),
    title: deleting ? '기존 일정 삭제 검증' : '새 일정 등록 검증',
  };
  const [saved, setSaved] = useState(false),
    [closed, setClosed] = useState(false);
  return closed ? (
    <p>{saved ? (deleting ? '일정 삭제됨' : '일정 등록됨') : '닫힘'}</p>
  ) : (
    <CalendarEventEditor
      routineId="fixture"
      initial={initial}
      {...(deleting
        ? {
            event: {
              ...initial,
              id: 'fixture-event',
              fingerprint: 'fixture-fingerprint',
              recurring: false,
              hasAttendees: false,
            },
          }
        : {})}
      calendarIds={['holiday', 'fixture']}
      onSaved={() => setSaved(true)}
      onClose={() => setClosed(true)}
    />
  );
}
createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).has('calendar') ? (
    <NewCalendarFixture />
  ) : (
    <main style={{ padding: 18 }}>
      <p>합성 데이터 UI 검증 · 계정 접근 없음</p>
      <article className="briefing-card briefing-insight-card is-email">
        <EmailBriefingDisclosure
          title="워크숍 참석 회신"
          summary="2026년 9월 16일 오후 3시까지 참석 여부를 회신해주세요."
          calendarText="2026년 9월 16일 오후 3시 회신 마감"
          mailCopies={copies}
          mailAccount={copies[0]!.account}
          receivedAt={copies[0]!.receivedAt}
          mailOpenTarget={{ routineId: 'fixture', historyId: 'history', itemId: 'mail' }}
        >
          <p>회의 장소를 확인한 뒤 회신하세요.</p>
        </EmailBriefingDisclosure>
      </article>
    </main>
  ),
);
