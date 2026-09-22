import React from 'react';
import { createRoot } from 'react-dom/client';
import { EmailCalendarButton } from '../src/email-calendar';
import '../src/styles.css';
import '../src/workspace.css';
window.fetch = async (path) =>
  new Response(
    JSON.stringify(
      String(path).endsWith('/session')
        ? { token: 'synthetic' }
        : String(path).endsWith('/todo/draft')
          ? {
              draft: {
                title: '회의 자료 검토 의견 보내기',
                notes: '자료를 검토하고 핵심 의견을 정리해 전달합니다.',
                dueDate: '2026-09-20',
              },
              notice: '이메일 요약의 마감일을 반영했습니다. 내용을 확인한 뒤 저장해주세요.',
            }
          : String(path).endsWith('/todo/create')
            ? {
                taskId: '11111111-1111-4111-8111-111111111111',
                reminderState: 'created',
                message: 'GOSU 할 일과 Apple 미리 알림에 추가했습니다.',
              }
            : {
                projects: [
                  { id: '22222222-2222-4222-8222-222222222222', name: 'Research project' },
                ],
                authorized: true,
                lists: [{ id: 'icloud', name: '개인 할 일', source: 'iCloud', writable: true }],
                defaultListId: 'icloud',
              },
    ),
    { headers: { 'content-type': 'application/json' } },
  );
createRoot(document.getElementById('root')).render(
  <main style={{ maxWidth: 800, margin: '40px auto', background: 'white', padding: 24 }}>
    <h2>이메일 요약 · 검증용</h2>
    <p>회의 준비 자료를 검토하고 의견을 정리해주세요.</p>
    <EmailCalendarButton
      routineId="fixture"
      title="Re: 회의 준비 자료 검토"
      text="회의 준비 자료를 검토하고 9월 20일까지 의견을 보내주세요."
      receivedAt="2026-09-14T00:00:00Z"
    />
  </main>,
);
