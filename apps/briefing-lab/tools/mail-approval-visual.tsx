import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { AssistantSettings } from '../src/assistant-settings';
import { initialRealWorkspace } from '../src/workspace-defaults';
import '../src/styles.css';
import '../src/workspace.css';

// Isolated visual fixture: never connect to a user's source or consent backend.
window.fetch = async () =>
  new Response(
    JSON.stringify({
      token: 'fixture',
      providers: [],
      calendars: [],
      authorized: false,
      lists: [],
      projects: [],
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
function Preview() {
  const [live, setLive] = useState({
    ...defaultLiveSettings(),
    assistant: { ...defaultAssistantPreferences(), mailAi: true },
  });
  return (
    <main
      style={{ maxWidth: 760, height: '100vh', overflow: 'auto', margin: '0 auto', padding: 20 }}
    >
      <p>합성 설정 화면 · 실제 권한 변경 없음</p>
      <AssistantSettings
        routine={{ ...initialRealWorkspace(new Date().toISOString()).routines[0]!, live }}
        onChange={(next) =>
          setLive({ ...next, assistant: next.assistant ?? defaultAssistantPreferences() })
        }
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
