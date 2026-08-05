import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROJECT_CHAT_LAYOUT_STATE,
  PROJECT_CHAT_LAYOUT_STORAGE_KEY,
  activeSessionIdsForProject,
  loadProjectChatLayoutState,
  parseProjectChatLayoutState,
  projectChatSessionKey,
  resolveProjectChatSessionId,
  saveProjectChatLayoutState,
  VolatileProjectChatDrafts,
  VolatileProjectChatScrollPositions,
  VolatileProjectChatUnreadAssistantMessages,
} from '../src/renderer/src/project-chat-session-state';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessions = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    projectId,
    title: 'Project chat',
    isDefault: true,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    projectId,
    title: 'Second chat',
    isDefault: false,
    createdAt: '2026-08-04T00:01:00.000Z',
    updatedAt: '2026-08-04T00:01:00.000Z',
  },
] as const;

describe('Project Chat session state', () => {
  it('persists and clamps the independently resizable sessions rail', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(loadProjectChatLayoutState(storage)).toEqual(DEFAULT_PROJECT_CHAT_LAYOUT_STATE);
    expect(saveProjectChatLayoutState(storage, { schemaVersion: 1, sessionRailWidth: 272 })).toBe(
      true,
    );
    expect(values.has(PROJECT_CHAT_LAYOUT_STORAGE_KEY)).toBe(true);
    expect(loadProjectChatLayoutState(storage).sessionRailWidth).toBe(272);
    expect(
      parseProjectChatLayoutState({ schemaVersion: 1, sessionRailWidth: 20 }).sessionRailWidth,
    ).toBe(160);
    expect(
      parseProjectChatLayoutState({ schemaVersion: 1, sessionRailWidth: 900 }).sessionRailWidth,
    ).toBe(360);
  });

  it('preserves a valid selection and otherwise falls back to the default session', () => {
    expect(resolveProjectChatSessionId(sessions, sessions[1].id)).toBe(sessions[1].id);
    expect(resolveProjectChatSessionId(sessions, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).toBe(
      sessions[0].id,
    );
    expect(resolveProjectChatSessionId([], null)).toBeNull();
  });

  it('keeps active turn state isolated by project and session', () => {
    const active = new Set([
      projectChatSessionKey(projectId, sessions[1].id),
      projectChatSessionKey('dddddddd-dddd-4ddd-8ddd-dddddddddddd', sessions[0].id),
    ]);
    expect(activeSessionIdsForProject(projectId, active, sessions)).toEqual(
      new Set([sessions[1].id]),
    );
  });

  it('keeps unsent drafts isolated while switching projects and sessions', () => {
    const drafts = new VolatileProjectChatDrafts();
    drafts.write(projectId, sessions[0].id, 'default-session draft');
    drafts.write(projectId, sessions[1].id, 'second-session draft');
    drafts.write('dddddddd-dddd-4ddd-8ddd-dddddddddddd', sessions[0].id, 'other project');

    expect(drafts.read(projectId, sessions[0].id)).toBe('default-session draft');
    expect(drafts.read(projectId, sessions[1].id)).toBe('second-session draft');
    expect(drafts.read('dddddddd-dddd-4ddd-8ddd-dddddddddddd', sessions[0].id)).toBe(
      'other project',
    );
    drafts.write(projectId, sessions[0].id, '');
    expect(drafts.read(projectId, sessions[0].id)).toBe('');
    expect(drafts.read(projectId, sessions[1].id)).toBe('second-session draft');
  });

  it('keeps finite scroll positions isolated and distinguishes the top from no saved position', () => {
    const positions = new VolatileProjectChatScrollPositions();
    expect(positions.read(projectId, sessions[0].id)).toBeNull();

    expect(positions.write(projectId, sessions[0].id, 0)).toBe(true);
    expect(positions.write(projectId, sessions[1].id, 640.5)).toBe(true);
    expect(positions.write('dddddddd-dddd-4ddd-8ddd-dddddddddddd', sessions[0].id, 120)).toBe(true);

    expect(positions.read(projectId, sessions[0].id)).toBe(0);
    expect(positions.read(projectId, sessions[1].id)).toBe(640.5);
    expect(positions.read('dddddddd-dddd-4ddd-8ddd-dddddddddddd', sessions[0].id)).toBe(120);
  });

  it('rejects invalid positions and bounds unexpectedly large layout values', () => {
    const positions = new VolatileProjectChatScrollPositions();
    positions.write(projectId, sessions[0].id, 42);

    expect(positions.write(projectId, sessions[0].id, Number.NaN)).toBe(false);
    expect(positions.write(projectId, sessions[0].id, Number.POSITIVE_INFINITY)).toBe(false);
    expect(positions.write(projectId, sessions[0].id, -1)).toBe(false);
    expect(positions.read(projectId, sessions[0].id)).toBe(42);

    expect(positions.write(projectId, sessions[1].id, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(positions.read(projectId, sessions[1].id)).toBe(10_000_000);
  });

  it('keeps the exact unread assistant response through later user messages and session switches', () => {
    const unread = new VolatileProjectChatUnreadAssistantMessages();
    const defaultSessionId = sessions[0].id;
    const secondSessionId = sessions[1].id;

    expect(
      unread.observe(projectId, defaultSessionId, [
        { id: 'user-old', role: 'user' },
        { id: 'assistant-old', role: 'assistant' },
      ]),
    ).toBeNull();
    unread.noteCompletedTurn(projectId, defaultSessionId, 'turn-unread');
    expect(
      unread.observe(projectId, defaultSessionId, [
        { id: 'user-old', role: 'user' },
        { id: 'assistant-old', role: 'assistant' },
        { id: 'assistant-unread', role: 'assistant', turnId: 'turn-unread' },
      ]),
    ).toBe('assistant-unread');

    expect(
      unread.observe(projectId, defaultSessionId, [
        { id: 'assistant-unread', role: 'assistant', turnId: 'turn-unread' },
        { id: 'user-after-assistant', role: 'user' },
      ]),
    ).toBe('assistant-unread');
    unread.noteCompletedTurn(projectId, secondSessionId, 'turn-other-session');
    expect(
      unread.observe(projectId, secondSessionId, [
        {
          id: 'assistant-other-session',
          role: 'assistant',
          turnId: 'turn-other-session',
        },
      ]),
    ).toBe('assistant-other-session');

    expect(unread.read(projectId, defaultSessionId)).toBe('assistant-unread');
    expect(unread.read(projectId, secondSessionId)).toBe('assistant-other-session');
  });

  it('acknowledges unread responses by identity and does not resurrect them on duplicate events', () => {
    const unread = new VolatileProjectChatUnreadAssistantMessages();
    const sessionId = sessions[0].id;
    const messages = [{ id: 'assistant-one', role: 'assistant', turnId: 'turn-one' }] as const;

    unread.noteCompletedTurn(projectId, sessionId, 'turn-one');
    expect(unread.observe(projectId, sessionId, messages)).toBe('assistant-one');
    expect(unread.acknowledge(projectId, sessionId, 'stale-assistant')).toBe('assistant-one');
    expect(unread.acknowledge(projectId, sessionId, 'assistant-one')).toBeNull();
    unread.noteCompletedTurn(projectId, sessionId, 'turn-one');
    expect(unread.observe(projectId, sessionId, messages)).toBeNull();

    unread.noteCompletedTurn(projectId, sessionId, 'turn-two');
    expect(
      unread.observe(projectId, sessionId, [
        ...messages,
        { id: 'assistant-two', role: 'assistant', turnId: 'turn-two' },
      ]),
    ).toBe('assistant-two');
  });

  it('retains completion intent when its event load is superseded by a later session load', () => {
    const unread = new VolatileProjectChatUnreadAssistantMessages();
    const sessionId = sessions[0].id;

    unread.observe(projectId, sessionId, [{ id: 'assistant-old', role: 'assistant' }]);
    unread.noteCompletedTurn(projectId, sessionId, 'turn-completed');
    // The event-triggered request is invalidated before it can call observe().
    expect(unread.read(projectId, sessionId)).toBeNull();

    expect(
      unread.observe(projectId, sessionId, [
        { id: 'assistant-old', role: 'assistant' },
        {
          id: 'assistant-from-superseded-event',
          role: 'assistant',
          turnId: 'turn-completed',
        },
      ]),
    ).toBe('assistant-from-superseded-event');
  });

  it('announces the exact completed turn instead of a newer assistant in the same snapshot', () => {
    const unread = new VolatileProjectChatUnreadAssistantMessages();
    const sessionId = sessions[0].id;
    unread.observe(projectId, sessionId, [{ id: 'assistant-baseline', role: 'assistant' }]);
    unread.noteCompletedTurn(projectId, sessionId, 'turn-older');

    expect(
      unread.observe(projectId, sessionId, [
        { id: 'assistant-baseline', role: 'assistant' },
        { id: 'assistant-exact', role: 'assistant', turnId: 'turn-older' },
        { id: 'assistant-newer', role: 'assistant', turnId: 'turn-newer' },
      ]),
    ).toBe('assistant-exact');
  });

  it('ignores stale completion snapshots and cannot regress to an older out-of-order turn', () => {
    const unread = new VolatileProjectChatUnreadAssistantMessages();
    const sessionId = sessions[0].id;
    const oldAssistant = {
      id: 'assistant-old',
      role: 'assistant',
      turnId: 'turn-old',
    } as const;

    unread.noteCompletedTurn(projectId, sessionId, 'turn-not-saved-yet');
    expect(unread.observe(projectId, sessionId, [oldAssistant])).toBeNull();

    const messages = [
      oldAssistant,
      { id: 'assistant-new', role: 'assistant', turnId: 'turn-new' },
    ] as const;
    unread.noteCompletedTurn(projectId, sessionId, 'turn-new');
    expect(unread.observe(projectId, sessionId, messages)).toBe('assistant-new');
    expect(unread.acknowledge(projectId, sessionId, 'assistant-new')).toBeNull();
    unread.noteCompletedTurn(projectId, sessionId, 'turn-old');
    expect(unread.observe(projectId, sessionId, messages)).toBeNull();
  });
});
