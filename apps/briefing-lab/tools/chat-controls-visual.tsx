import { createRoot } from 'react-dom/client';
import { BriefingChat } from '../src/briefing-chat';
import { initialRealWorkspace } from '../src/workspace-defaults';
import '../src/styles.css';
import '../src/workspace.css';
import '../src/global-assistant-chat.css';
const routine = initialRealWorkspace('2026-09-13T00:00:00Z').routines[0]!;
let items = [
  {
    id: crypto.randomUUID(),
    routineId: routine.id,
    owner: 'fixture',
    scope: 'fixture',
    prompt: '두 논문의 가정과 실험 결과를 비교해줘.',
    attachmentIds: [],
    revision: 0,
    state: 'queued',
    createdAt: '2026-09-13T00:00:00Z',
    updatedAt: '2026-09-13T00:00:00Z',
  },
];
// No network/provider/user data: every request is a synthetic fixture response.
window.fetch = async (url, init) => {
  const path = String(url),
    body = init?.body ? JSON.parse(String(init.body)) : {};
  let value: unknown = {};
  if (path.endsWith('/session')) value = { token: 'fixture' };
  else if (path.endsWith('/get'))
    value = {
      messages: [
        {
          role: 'user',
          text: '첨부한 문서의 핵심 가정을 정리해줘.',
          createdAt: '2026-09-13T12:00:00Z',
        },
        {
          role: 'assistant',
          text: '**핵심 가정**과 **실험 결과**를 구분하여 확인하겠습니다.\n\n이 화면은 첨부·대기열 배치 검증용이며 실제 AI 호출은 없습니다.',
          createdAt: '2026-09-13T12:00:02Z',
        },
      ],
    };
  else if (path.endsWith('/list')) value = { items, active: true, canSteer: true, canAttach: true };
  else if (path.endsWith('/choose'))
    value = {
      attachments: [
        {
          id: crypto.randomUUID(),
          projectId: 'b13f1000-0000-4000-8000-000000000001',
          sessionId: crypto.randomUUID(),
          kind: 'document',
          format: 'text',
          mediaType: 'text/plain',
          displayName: '연구 메모.txt',
          byteSize: 100,
          sha256: 'a'.repeat(64),
          unitLabel: 'part',
          unitCount: 1,
          extractedCharacters: 100,
          truncated: false,
          textAvailable: true,
          visualAvailable: false,
          expiresAt: '2026-09-14T00:00:00Z',
        },
      ],
    };
  else if (path.endsWith('/edit'))
    items = items.map((q) =>
      q.id === body.id ? { ...q, prompt: body.prompt, revision: q.revision + 1 } : q,
    );
  else if (path.endsWith('/delete')) items = items.filter((q) => q.id !== body.id);
  else if (path.endsWith('/enqueue'))
    items.push({ ...items[0], ...body, state: 'queued', revision: 0 });
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
};
createRoot(document.getElementById('root')!).render(
  <div
    style={{ height: '100vh', padding: 12, boxSizing: 'border-box', maxWidth: 980, margin: 'auto' }}
  >
    <button
      type="button"
      onClick={() => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File(['synthetic only'], '검증용 문서.txt'));
        document
          .querySelector('.briefing-chat')
          ?.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }));
      }}
    >
      파일 드래그 강조 확인 · 검증용
    </button>
    <BriefingChat routine={routine} globalMode onSettings={() => undefined} />
  </div>,
);
