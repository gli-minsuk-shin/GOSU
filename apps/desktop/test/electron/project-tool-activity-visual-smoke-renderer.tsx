import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setUiLanguage, useUiText, type UiLanguage } from '@gosu/ui/language';

import {
  mergeProjectToolActivityEvents,
  ProjectToolActivityView,
  type ProjectToolActivityEvent,
} from '../../src/renderer/src/project-tool-activity-view';
import '../../src/renderer/src/styles.css';

// No preload, GOSU IPC, provider, filesystem, or user settings are available to this fixture.
const longQuery =
  'FiLM conditioned residual networks / lambda-dependent refinement / gradient consistency / model architecture verification / 연구 계획';
const longTarget =
  'Research Notes/Project Progress/FiLM-conditioned-residual-networks-and-lambda-dependent-refinement/architecture-consistency-and-gradient-flow-review/2026-09-08/training-design.md';

function event(
  callId: string,
  tool: string,
  stage: ProjectToolActivityEvent['stage'],
  activity: ProjectToolActivityEvent['activity'],
): ProjectToolActivityEvent {
  const completed = stage === 'tool_completed';
  return {
    turnId: 'isolated-visual-turn',
    callId,
    tool,
    stage,
    occurredAt: new Date(Date.now() - (completed ? 1_000 : 1_500)).toISOString(),
    ...(completed ? { success: true, elapsedMs: 500 } : {}),
    activity,
  };
}

function initialEvents() {
  const events: ProjectToolActivityEvent[] = [];
  const calls: [string, string, NonNullable<ProjectToolActivityEvent['activity']>][] = [
    [
      'summary',
      'read_workspace',
      { section: 'summary' as const, counts: [{ kind: 'tasks' as const, value: 8 }] },
    ],
    [
      'board',
      'read_workspace',
      { section: 'board' as const, counts: [{ kind: 'tasks' as const, value: 12 }] },
    ],
    [
      'notes',
      'list_local_notes',
      { query: longQuery, limit: 20, counts: [{ kind: 'notes' as const, value: 3 }] },
    ],
  ];
  for (const [callId, tool, activity] of calls) {
    events.push(event(callId, tool, 'tool_started', { ...activity }));
    const completed = event(callId, tool, 'tool_completed', {
      ...activity,
      ...(activity.counts ? { counts: [...activity.counts] } : {}),
    });
    events.push(completed, { ...completed });
  }
  events.push(
    event('read-note', 'read_local_note', 'tool_started', {
      target: longTarget,
      offset: 0,
      limit: 4_000,
    }),
  );
  return mergeProjectToolActivityEvents([], events);
}

function Fixture() {
  const t = useUiText();
  const [events, setEvents] = useState(initialEvents);
  const [turnInFlight, setTurnInFlight] = useState(true);
  const chooseLanguage = (language: UiLanguage) => {
    setUiLanguage(language);
    document.documentElement.lang = language;
  };
  return (
    <main className="tool-activity-visual-shell">
      <section className="tool-activity-visual-pane">
        <header className="tool-activity-visual-heading">
          <h1>{t('Project Copilot')}</h1>
          <span>FM-LM · Codex · GPT-6-Astra</span>
        </header>
        <article className="chat-message assistant">
          <header>
            <strong>GOSU</strong>
            <span>{t('Working')}</span>
          </header>
          <ProjectToolActivityView
            events={events}
            providerLabel="Codex"
            turnInFlight={turnInFlight}
          />
        </article>
        <p className="tool-activity-visual-note">
          {t('Tool activity')} · Isolated fixture · No real account or provider calls
        </p>
        <div className="tool-activity-visual-controls">
          <button
            data-testid="reset"
            onClick={() => {
              setEvents(initialEvents());
              setTurnInFlight(true);
            }}
          >
            Reset fixture
          </button>
          <button
            data-testid="complete"
            onClick={() => {
              const completed = event('read-note', 'read_local_note', 'tool_completed', {
                counts: [{ kind: 'characters', value: 3_420 }],
                truncated: true,
              });
              setEvents((current) =>
                mergeProjectToolActivityEvents(current, [completed, completed]),
              );
            }}
          >
            Complete read
          </button>
          <button
            data-testid="more"
            onClick={() => {
              setEvents((current) =>
                mergeProjectToolActivityEvents(
                  current,
                  Array.from({ length: 4 }, (_, index) =>
                    event(`extra-${index}`, 'read_workspace', 'tool_completed', {
                      section: 'objective',
                    }),
                  ),
                ),
              );
            }}
          >
            Add four calls
          </button>
          <button data-testid="stop" onClick={() => setTurnInFlight(false)}>
            Stop fixture
          </button>
          <button data-testid="language-ko" onClick={() => chooseLanguage('ko')}>
            한국어
          </button>
          <button data-testid="language-en" onClick={() => chooseLanguage('en')}>
            English
          </button>
        </div>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('tool_activity_visual_root_missing');
createRoot(root).render(<Fixture />);
