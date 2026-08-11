import { describe, expect, it, vi } from 'vitest';

import { HermesAcpApprovalService } from '../src/main/hermes-acp-approval-service';

const projectId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

function approvalInput() {
  return {
    projectId,
    sessionId,
    acpSessionId: 'hermes-session-1',
    options: [
      { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'session', kind: 'allow_always', name: 'Allow for this session' },
      { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
    ],
    toolCall: {
      toolCallId: 'tool-1',
      title: 'Run project tests',
      kind: 'execute',
      status: 'pending',
      displayText: 'python -m pytest',
      displayTextTruncated: false,
      displayTextUnsafe: false,
      editPreview: null,
    },
  } as const;
}

describe('HermesAcpApprovalService', () => {
  it('maps ACP permission options into an active-project approval and returns the selected option', async () => {
    const service = new HermesAcpApprovalService();
    const events: unknown[] = [];
    service.on('event', (event) => events.push(event));

    const outcome = service.request(approvalInput());
    const [request] = service.list(projectId, sessionId);

    expect(request).toMatchObject({
      projectId,
      sessionId,
      acpSessionId: 'hermes-session-1',
      toolCallId: 'tool-1',
      title: 'Run project tests',
      kind: 'execute',
      safeSummary: {
        text: 'Run project tests',
        commandPreview: 'python -m pytest',
      },
      options: ['allow_once', 'allow_session', 'deny'],
    });

    expect(service.resolve(request!.id, 'allow_session')).toEqual({ outcome: 'allowed' });
    await expect(outcome).resolves.toEqual({ outcome: 'selected', optionId: 'session' });
    expect(service.list(projectId, sessionId)).toEqual([]);
    expect(events).toHaveLength(2);
  });

  it('never reads raw tool payloads and uses only the sanitized ACP display text', async () => {
    const service = new HermesAcpApprovalService();
    const outcome = service.request({
      ...approvalInput(),
      toolCall: {
        ...approvalInput().toolCall,
        displayText: 'safe preview',
        rawInput: { command: 'SECRET_SHOULD_NOT_APPEAR' },
      },
    });
    const [request] = service.list(projectId, sessionId);

    expect(request?.safeSummary.commandPreview).toBe('safe preview');
    expect(JSON.stringify(request)).not.toContain('SECRET_SHOULD_NOT_APPEAR');
    service.resolve(request!.id, 'deny');
    await expect(outcome).resolves.toEqual({ outcome: 'cancelled' });
  });

  it('preserves command whitespace and fails closed when any command suffix is hidden or unsafe', async () => {
    const service = new HermesAcpApprovalService();
    const multiline = service.request({
      ...approvalInput(),
      toolCall: {
        ...approvalInput().toolCall,
        displayText: '$ printf ok # comment\nrm -rf project-output',
      },
    });
    const [request] = service.list(projectId, sessionId);
    expect(request?.safeSummary.commandPreview).toBe(
      '$ printf ok # comment\nrm -rf project-output',
    );
    service.resolve(request!.id, 'deny');
    await expect(multiline).resolves.toEqual({ outcome: 'cancelled' });

    await expect(
      service.request({
        ...approvalInput(),
        toolCall: {
          ...approvalInput().toolCall,
          displayText: `${'x'.repeat(2_048)}; rm -rf project-output`,
        },
      }),
    ).resolves.toEqual({ outcome: 'cancelled' });
    await expect(
      service.request({
        ...approvalInput(),
        toolCall: {
          ...approvalInput().toolCall,
          displayText: '$ harmless-command',
          displayTextTruncated: true,
        },
      }),
    ).resolves.toEqual({ outcome: 'cancelled' });
    await expect(
      service.request({
        ...approvalInput(),
        toolCall: {
          ...approvalInput().toolCall,
          displayText: '$ harmless-command\u202e hidden',
          displayTextUnsafe: true,
        },
      }),
    ).resolves.toEqual({ outcome: 'cancelled' });
    await expect(
      service.request({
        ...approvalInput(),
        toolCall: {
          ...approvalInput().toolCall,
          displayText: '   \n\t',
        },
      }),
    ).resolves.toEqual({ outcome: 'cancelled' });
  });

  it('fails closed when a decision was not offered and cancels pending sessions on shutdown', async () => {
    const service = new HermesAcpApprovalService();
    const outcome = service.request({
      ...approvalInput(),
      options: [
        { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ],
    });
    const [request] = service.list(projectId, sessionId);

    expect(() => service.resolve(request!.id, 'allow_session')).toThrow(
      'hermes_acp_approval_decision_not_offered',
    );
    expect(service.cancelAll()).toBe(1);
    await expect(outcome).resolves.toEqual({ outcome: 'cancelled' });
  });

  it('requires an exact bounded edit preview and isolates cancellation by all three scopes', async () => {
    const service = new HermesAcpApprovalService();
    const deniedEdit = service.request({
      ...approvalInput(),
      toolCall: { ...approvalInput().toolCall, kind: 'edit', editPreview: null },
    });
    await expect(deniedEdit).resolves.toEqual({ outcome: 'cancelled' });
    const truncatedEdit = service.request({
      ...approvalInput(),
      toolCall: {
        ...approvalInput().toolCall,
        kind: 'edit',
        editPreview: {
          path: 'src/model.py',
          pathTruncated: false,
          pathUnsafe: false,
          oldText: 'before',
          newText: 'after',
          oldTextTruncated: false,
          newTextTruncated: true,
          oldTextUnsafe: false,
          newTextUnsafe: false,
        },
      },
    });
    await expect(truncatedEdit).resolves.toEqual({ outcome: 'cancelled' });

    for (const editPreview of [
      {
        path: 'src/safe.py\n../hidden.py',
        pathTruncated: false,
        pathUnsafe: true,
        oldText: 'before',
        newText: 'after',
        oldTextTruncated: false,
        newTextTruncated: false,
        oldTextUnsafe: false,
        newTextUnsafe: false,
      },
      {
        path: `src/${'x'.repeat(1_025)}.py`,
        pathTruncated: true,
        pathUnsafe: false,
        oldText: 'before',
        newText: 'after',
        oldTextTruncated: false,
        newTextTruncated: false,
        oldTextUnsafe: false,
        newTextUnsafe: false,
      },
      {
        path: 'src/safe.py\u202ehidden.py',
        pathTruncated: false,
        pathUnsafe: true,
        oldText: 'before',
        newText: 'after',
        oldTextTruncated: false,
        newTextTruncated: false,
        oldTextUnsafe: false,
        newTextUnsafe: false,
      },
      {
        path: 'src/model.py',
        pathTruncated: false,
        pathUnsafe: false,
        oldText: 'safe\u202ehidden',
        newText: 'after',
        oldTextTruncated: false,
        newTextTruncated: false,
        oldTextUnsafe: true,
        newTextUnsafe: false,
      },
      {
        path: 'src/model.py',
        pathTruncated: false,
        pathUnsafe: false,
        oldText: 'before',
        newText: 'safe\u0000hidden',
        oldTextTruncated: false,
        newTextTruncated: false,
        oldTextUnsafe: false,
        newTextUnsafe: true,
      },
    ]) {
      await expect(
        service.request({
          ...approvalInput(),
          toolCall: { ...approvalInput().toolCall, kind: 'edit', editPreview },
        }),
      ).resolves.toEqual({ outcome: 'cancelled' });
    }
    expect(service.list(projectId, sessionId)).toHaveLength(0);

    const first = service.request(approvalInput());
    const otherProject = '33333333-3333-4333-8333-333333333333';
    const second = service.request({ ...approvalInput(), projectId: otherProject });
    expect(service.cancelAcpSession(projectId, sessionId, 'hermes-session-1')).toBe(1);
    await expect(first).resolves.toEqual({ outcome: 'cancelled' });
    expect(service.list(otherProject, sessionId)).toHaveLength(1);
    service.cancelAll();
    await expect(second).resolves.toEqual({ outcome: 'cancelled' });
  });

  it('expires unanswered requests without starting the operation', async () => {
    vi.useFakeTimers();
    try {
      const service = new HermesAcpApprovalService();
      const outcome = service.request(approvalInput());
      await vi.advanceTimersByTimeAsync(55_000);
      await expect(outcome).resolves.toEqual({ outcome: 'cancelled' });
      expect(service.list(projectId, sessionId)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
