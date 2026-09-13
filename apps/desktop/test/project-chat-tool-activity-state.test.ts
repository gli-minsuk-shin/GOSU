import { describe, expect, it } from 'vitest';
import type { ProjectChatEvent } from '../src/shared/project-chat-contracts';
import {
  reduceProjectChatToolActivity,
  type ProjectChatToolActivityState,
} from '../src/renderer/src/project-chat-tool-activity-state';
import { projectChatSessionKey } from '../src/renderer/src/project-chat-session-state';
import { projectToolActivityRows } from '../src/renderer/src/project-tool-activity-view';

const scope = {
  projectId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  turnId: 'turn-one',
};
const key = projectChatSessionKey(scope.projectId, scope.sessionId);
const event: Extract<ProjectChatEvent, { type: 'agent.progress' }> = {
  ...scope,
  type: 'agent.progress',
  stage: 'tool_started',
  callId: 'call-one',
  tool: 'read_workspace',
  occurredAt: '2026-09-08T10:00:00.000Z',
  activity: { section: 'board' },
};
describe('project/session-bound live tool activity', () => {
  it('updates one call without losing its start metadata and retains it after the response ends', () => {
    const before: ProjectChatToolActivityState = {};
    let state = reduceProjectChatToolActivity(before, { ...scope, type: 'turn.started' });
    state = reduceProjectChatToolActivity(state, event);
    state = reduceProjectChatToolActivity(state, {
      ...event,
      stage: 'tool_completed',
      success: true,
      occurredAt: '2026-09-08T10:00:00.250Z',
      elapsedMs: 250,
      activity: { counts: [{ kind: 'tasks', value: 8 }] },
    });
    const rows = projectToolActivityRows(state[key]!.events);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      elapsedMs: 250,
      activity: { section: 'board', counts: [{ kind: 'tasks', value: 8 }] },
    });
    const completed = reduceProjectChatToolActivity(state, {
      ...scope,
      type: 'turn.completed',
      status: 'complete',
    });
    expect(completed[key]!.finished).toBe(true);
    expect(completed[key]!.events).toBe(state[key]!.events);
    expect(before).toEqual({});
  });
  it('isolates matching call IDs in different projects and sessions', () => {
    const otherProject = {
      ...event,
      projectId: '33333333-3333-4333-8333-333333333333',
      activity: { section: 'objective' as const },
    };
    const otherSession = {
      ...event,
      sessionId: '44444444-4444-4444-8444-444444444444',
      activity: { section: 'summary' as const },
    };
    let state = reduceProjectChatToolActivity({}, event);
    state = reduceProjectChatToolActivity(state, otherProject);
    state = reduceProjectChatToolActivity(state, otherSession);
    expect(Object.keys(state)).toHaveLength(3);
    expect(state[key]!.events).toEqual([event]);
    expect(
      state[projectChatSessionKey(otherProject.projectId, otherProject.sessionId)]!.events,
    ).toEqual([otherProject]);
  });
  it('clears a new turn and ignores stale progress/terminal events without erasing current work', () => {
    let state = reduceProjectChatToolActivity({}, event);
    state = reduceProjectChatToolActivity(state, {
      ...scope,
      turnId: 'turn-two',
      type: 'turn.started',
    });
    const started = state;
    expect(state[key]!.events).toEqual([]);
    expect(reduceProjectChatToolActivity(state, event)).toBe(started);
    expect(
      reduceProjectChatToolActivity(state, {
        ...scope,
        type: 'turn.completed',
        status: 'complete',
      }),
    ).toBe(started);
    state = reduceProjectChatToolActivity(state, { ...event, turnId: 'turn-two' });
    expect(
      reduceProjectChatToolActivity(state, { ...scope, turnId: 'turn-two', type: 'turn.started' }),
    ).toBe(state);
    state = reduceProjectChatToolActivity(state, {
      ...scope,
      turnId: 'turn-two',
      type: 'turn.completed',
      status: 'interrupted',
    });
    expect(
      reduceProjectChatToolActivity(state, {
        ...event,
        turnId: 'turn-two',
        stage: 'tool_completed',
        success: true,
      }),
    ).toBe(state);
  });
  it('bounds memory by whole calls, not individual lifecycle rows', () => {
    let state: ProjectChatToolActivityState = {};
    for (let index = 0; index < 55; index++) {
      state = reduceProjectChatToolActivity(state, { ...event, callId: `call-${index}` });
      state = reduceProjectChatToolActivity(state, {
        ...event,
        callId: `call-${index}`,
        stage: 'tool_completed',
        success: true,
      });
    }
    expect(state[key]!.events).toHaveLength(80);
    expect(projectToolActivityRows(state[key]!.events)).toHaveLength(40);
    expect(state[key]!.events[0]!.callId).toBe('call-15');
  });
});
