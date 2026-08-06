import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../../src/renderer/src/styles.css';
import { SshApprovalCenter } from '../../src/renderer/src/ssh-approval-center';
import type { ResolveSshApprovalInput, SshApprovalRequest } from '../../src/shared/ssh-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const GRANT_ID = '55555555-5555-4555-8555-555555555555';

function approvalFixture(
  id: string,
  ordinal: number,
  overrides: Partial<SshApprovalRequest> = {},
): SshApprovalRequest {
  return {
    schemaVersion: 1,
    id,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    attemptId: ATTEMPT_ID,
    turnId: `turn-${ordinal}`,
    toolCallId: `tool-call-${ordinal}`,
    connectionId: CONNECTION_ID,
    connectionLabel: `Fixture GPU server ${ordinal}`,
    hostAlias: `fixture-gpu-${ordinal}`,
    targetDisplay: `researcher@gpu-${ordinal}.example.test:2222`,
    privilegeClass: 'standard',
    executionMode: 'remote_workspace',
    connectionVersion: 2,
    workspaceGrantId: GRANT_ID,
    workspaceGrantVersion: 3,
    workspaceRoot: '/workspace/research-project',
    workspaceWorkingDirectory: '/workspace/research-project/experiments',
    workspaceOperation: 'test',
    commandSha256: String(ordinal).repeat(64),
    commandPreview: `exec '/usr/bin/python3' 'experiment_${ordinal}.py'`,
    requestedAt: '2099-08-06T07:00:00.000Z',
    expiresAt: '2099-08-06T08:00:00.000Z',
    ...overrides,
  };
}

const longCommand = Array.from(
  { length: 180 },
  (_, index) =>
    `step_${String(index + 1).padStart(3, '0')} --dataset fixture_${index + 1}.json --metric validation_accuracy`,
).join('\n');

const longFileContent = Array.from(
  { length: 240 },
  (_, index) => `print("bounded remote experiment line ${index + 1}")`,
).join('\n');

const initialRequests: readonly SshApprovalRequest[] = [
  approvalFixture('66666666-6666-4666-8666-666666666666', 1, {
    workspaceOperation: 'edit',
    workspaceFileAction: 'create',
    workspaceFilePath: 'experiments/long_fixture.py',
    workspaceFileContentSha256: 'a'.repeat(64),
    workspaceFileContent: longFileContent,
    commandPreview: longCommand,
  }),
  approvalFixture('77777777-7777-4777-8777-777777777777', 2),
  approvalFixture('88888888-8888-4888-8888-888888888888', 3),
];

function SmokeFixture() {
  const [requests, setRequests] = useState(initialRequests);
  const [resolutions, setResolutions] = useState<readonly ResolveSshApprovalInput[]>([]);

  const resolve = (input: ResolveSshApprovalInput) => {
    setResolutions((current) => [...current, input]);
    setRequests((current) => current.filter((request) => request.id !== input.approvalId));
  };

  return (
    <>
      <main className="desktop-shell" aria-label="Project Chat fixture">
        <header className="titlebar">
          <span className="logo">G</span>
          <strong>GOSU</strong>
          <span>SSH approval geometry fixture</span>
        </header>
        <aside className="desktop-nav" aria-label="Projects">
          <strong>Fixture project</strong>
        </aside>
        <section className="desktop-content desktop-content-chat">
          <div className="project-chat-shell">
            <div className="chat-transcript-region">
              <div className="chat-transcript">
                <article className="chat-message user">
                  <strong>YOU</strong>
                  <p>Run the approved experiment on the linked server.</p>
                </article>
              </div>
            </div>
            <div className="chat-compose-area">
              <div className="chat-composer">
                <textarea aria-label="Message" defaultValue="Waiting for approval" />
                <button className="primary-button" autoFocus>
                  Send
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
      <output
        hidden
        data-smoke-ready="true"
        data-resolution-count={resolutions.length}
        data-resolution-log={JSON.stringify(resolutions)}
      />
      <SshApprovalCenter
        requests={requests}
        describeScope={() => 'Fixture project · Default session'}
        onResolve={resolve}
      />
    </>
  );
}

const root = document.querySelector('#root');
if (!root) throw new Error('missing_ssh_approval_smoke_root');
createRoot(root).render(<SmokeFixture />);
