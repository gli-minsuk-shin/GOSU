import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { HermesAcpApprovalCenter } from '../src/renderer/src/hermes-acp-approval-center';
import type { HermesAcpApprovalRequest } from '../src/shared/hermes-acp-approval-contracts';

const approval: HermesAcpApprovalRequest = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  sessionId: '33333333-3333-4333-8333-333333333333',
  acpSessionId: 'acp-session-must-not-render',
  toolCallId: 'tool-call-must-not-render',
  title: 'Run the project test suite',
  kind: 'execute',
  safeSummary: {
    text: 'Hermes requests permission to run the selected test target.',
    commandPreview: 'pnpm test --filter project-fixture',
  },
  options: ['allow_once', 'allow_session', 'deny'],
  createdAt: new Date(Date.now() - 1_000).toISOString(),
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
};

describe('Hermes ACP approval center', () => {
  it('renders the first request in the centered accessible approval pattern', () => {
    const second: HermesAcpApprovalRequest = {
      ...approval,
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Second request must wait',
    };
    const html = renderToStaticMarkup(
      <HermesAcpApprovalCenter requests={[approval, second]} onResolve={vi.fn()} />,
    );

    expect(html).toContain('ssh-approval-backdrop hermes-acp-approval-backdrop');
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('HERMES AGENT APPROVAL');
    expect(html).toContain('Hermes permission required');
    expect(html).toContain('Reviewing 1 of 2');
    expect(html).toContain(approval.title);
    expect(html).toContain('Kind · execute');
    expect(html).toContain(approval.safeSummary.text);
    expect(html).toContain(approval.safeSummary.commandPreview);
    expect(html).not.toContain(second.title);
  });

  it('shows only bounded review data and never exposes opaque transport IDs', () => {
    const html = renderToStaticMarkup(
      <HermesAcpApprovalCenter requests={[approval]} onResolve={vi.fn()} />,
    );

    expect(html).toContain('Reviewed Hermes command summary');
    expect(html).toContain('does not persist the structured raw');
    expect(html).toContain('may contain sensitive command arguments');
    expect(html).not.toContain(approval.acpSessionId);
    expect(html).not.toContain(approval.toolCallId);
    expect(html).not.toContain('rawInput');
    expect(html).not.toContain('rawOutput');
  });

  it('renders only the allow options carried by the validated request', () => {
    const html = renderToStaticMarkup(
      <HermesAcpApprovalCenter
        requests={[{ ...approval, options: ['allow_once', 'deny'] }]}
        onResolve={vi.fn()}
      />,
    );

    expect(html).toContain('>Deny</button>');
    expect(html).toContain('>Allow once</button>');
    expect(html).not.toContain('>Allow for session</button>');
  });

  it('keeps every decision visible but inert while resolution is pending', () => {
    const html = renderToStaticMarkup(
      <HermesAcpApprovalCenter
        requests={[approval]}
        busyApprovalIds={new Set([approval.id])}
        onResolve={vi.fn()}
      />,
    );

    expect(html.match(/disabled=""/gu)).toHaveLength(3);
    expect(html.indexOf('>Deny</button>')).toBeLessThan(
      html.indexOf('>Allow for session</button>'),
    );
    expect(html.indexOf('>Allow for session</button>')).toBeLessThan(
      html.indexOf('>Allow once</button>'),
    );
  });

  it('renders no modal when there is no pending request', () => {
    expect(
      renderToStaticMarkup(<HermesAcpApprovalCenter requests={[]} onResolve={vi.fn()} />),
    ).toBe('');
  });
});
