import { describe, expect, it } from 'vitest';

import {
  enqueueVisibleSshApproval,
  mergeHydratedSshApprovals,
  rememberResolvedSshApproval,
  removeSshApproval,
  shouldPresentSshApproval,
  upsertSshApproval,
} from '../src/renderer/src/ssh-approval-state';
import type { SshApprovalRequest } from '../src/shared/ssh-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

function approval(id: string, overrides: Partial<SshApprovalRequest> = {}): SshApprovalRequest {
  return {
    schemaVersion: 1,
    id,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    attemptId: '33333333-3333-4333-8333-333333333333',
    turnId: 'turn-fixture',
    toolCallId: `tool-${id}`,
    connectionId: '44444444-4444-4444-8444-444444444444',
    connectionLabel: 'Fixture server',
    hostAlias: 'fixture-server',
    commandPreview: 'READ results.json',
    requestedAt: '2026-08-06T00:00:00.000Z',
    expiresAt: '2026-08-06T00:05:00.000Z',
    ...overrides,
  };
}

describe('SSH approval renderer state', () => {
  it('upserts duplicate events and removes only the resolved approval', () => {
    const first = approval('55555555-5555-4555-8555-555555555555');
    const second = approval('66666666-6666-4666-8666-666666666666', {
      requestedAt: '2026-08-06T00:00:01.000Z',
    });

    expect(upsertSshApproval(upsertSshApproval([], second), first)).toEqual([first, second]);
    expect(upsertSshApproval([first, second], { ...first, connectionLabel: 'Updated' })).toEqual([
      { ...first, connectionLabel: 'Updated' },
      second,
    ]);
    expect(removeSshApproval([first, second], first.id)).toEqual([second]);
  });

  it('does not resurrect a request resolved while pending hydration was in flight', () => {
    const request = approval('77777777-7777-4777-8777-777777777777');
    const tombstones = rememberResolvedSshApproval(new Set(), request.id);

    expect(
      mergeHydratedSshApprovals(
        [],
        [request],
        { projectId: PROJECT_ID, sessionId: SESSION_ID },
        tombstones,
        Date.parse('2026-08-06T00:00:02.000Z'),
      ),
    ).toEqual([]);
  });

  it('does not resurrect a resolved approval when its requested event arrives late', () => {
    const request = approval('77777777-7777-4777-8777-777777777779');
    const scope = { projectId: PROJECT_ID, sessionId: SESSION_ID };
    let visible = enqueueVisibleSshApproval([], request, scope, new Set());
    const tombstones = rememberResolvedSshApproval(new Set(), request.id);
    visible = removeSshApproval(visible, request.id);

    expect(enqueueVisibleSshApproval(visible, request, scope, tombstones)).toEqual([]);
  });

  it('presents events only for the visible unresolved project session', () => {
    const request = approval('77777777-7777-4777-8777-777777777778');
    const scope = { projectId: PROJECT_ID, sessionId: SESSION_ID };

    expect(shouldPresentSshApproval(request, scope, new Set())).toBe(true);
    expect(shouldPresentSshApproval(request, null, new Set())).toBe(false);
    expect(
      shouldPresentSshApproval(
        request,
        { projectId: PROJECT_ID, sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        new Set(),
      ),
    ).toBe(false);
    expect(shouldPresentSshApproval(request, scope, new Set([request.id]))).toBe(false);
  });

  it('accepts only unexpired approvals from the exact active project session', () => {
    const valid = approval('88888888-8888-4888-8888-888888888888');
    const otherSession = approval('99999999-9999-4999-8999-999999999999', {
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const expired = approval('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
      expiresAt: '2026-08-05T23:59:59.000Z',
    });

    expect(
      mergeHydratedSshApprovals(
        [otherSession, expired],
        [otherSession, expired, valid],
        { projectId: PROJECT_ID, sessionId: SESSION_ID },
        new Set(),
        Date.parse('2026-08-06T00:00:02.000Z'),
      ),
    ).toEqual([valid]);
  });

  it('prunes current approvals outside the exact scope or already resolved', () => {
    const valid = approval('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const otherProject = approval('dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
      projectId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    });
    const otherSession = approval('ffffffff-ffff-4fff-8fff-ffffffffffff', {
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const resolved = approval('12121212-1212-4121-8121-121212121212');

    expect(
      mergeHydratedSshApprovals(
        [valid, otherProject, otherSession, resolved],
        [],
        { projectId: PROJECT_ID, sessionId: SESSION_ID },
        new Set([resolved.id]),
        Date.parse('2026-08-06T00:00:02.000Z'),
      ),
    ).toEqual([valid]);
  });

  it('bounds resolved-request tombstones while retaining the newest IDs', () => {
    let tombstones: ReadonlySet<string> = new Set();
    for (const id of ['first', 'second', 'third']) {
      tombstones = rememberResolvedSshApproval(tombstones, id, 2);
    }
    expect([...tombstones]).toEqual(['second', 'third']);
  });
});
