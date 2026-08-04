import { useState } from 'react';

import type {
  CreateSshConnectionInput,
  RemoveSshConnectionInput,
  SshConnectionProfile,
  UpdateSshConnectionInput,
} from '../../shared/ssh-contracts';

type MaybePromise<T> = T | Promise<T>;

const SSH_HOST_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export type SshHostAliasValidation = Readonly<
  | { valid: true; alias: string }
  | {
      valid: false;
      reason: 'empty' | 'ssh-command' | 'user-host' | 'option' | 'invalid-format';
      message: string;
    }
>;

export function validateSshHostAliasInput(value: string): SshHostAliasValidation {
  const candidate = value.trim();
  if (!candidate) {
    return { valid: false, reason: 'empty', message: 'Enter a Host alias from ~/.ssh/config.' };
  }

  const looksLikeSshCommand = /^(?:\/[^\s]+\/)?ssh\s+/iu.test(candidate);
  if (looksLikeSshCommand) {
    const forwardingNote = /(?:^|\s)-(?:[LRD])(?:\s|\d|$)/u.test(candidate)
      ? ' GOSU does not accept SSH forwarding options such as -L.'
      : '';
    return {
      valid: false,
      reason: 'ssh-command',
      message:
        'Enter only the Host alias (for example, research-gpu), not the full ssh command. Put HostName, User, and Port in ~/.ssh/config.' +
        forwardingNote,
    };
  }

  if (candidate.includes('@')) {
    return {
      valid: false,
      reason: 'user-host',
      message:
        'Enter only the Host alias. Put the User and HostName values under that Host in ~/.ssh/config.',
    };
  }

  if (candidate.startsWith('-')) {
    return {
      valid: false,
      reason: 'option',
      message: 'SSH options are not accepted here. Enter only a Host alias from ~/.ssh/config.',
    };
  }

  if (/\s/u.test(candidate)) {
    return {
      valid: false,
      reason: 'invalid-format',
      message: 'A Host alias cannot contain spaces. Enter only one Host name from ~/.ssh/config.',
    };
  }

  if (!SSH_HOST_ALIAS_PATTERN.test(candidate)) {
    return {
      valid: false,
      reason: 'invalid-format',
      message:
        'Use one Host alias containing only letters, numbers, dots, underscores, or hyphens.',
    };
  }

  return { valid: true, alias: candidate };
}

function invokeWithoutUnhandledRejection(operation: () => MaybePromise<unknown>) {
  void Promise.resolve()
    .then(operation)
    .catch(() => undefined);
}

export type SshConnectionsCardProps = Readonly<{
  connections: readonly SshConnectionProfile[];
  busy: boolean;
  testStatus?: Readonly<Record<string, string>>;
  onCreate: (input: CreateSshConnectionInput) => MaybePromise<unknown>;
  onUpdate: (input: UpdateSshConnectionInput) => MaybePromise<unknown>;
  onRemove: (input: RemoveSshConnectionInput) => MaybePromise<unknown>;
  onTest: (connectionId: string) => MaybePromise<unknown>;
}>;

export function SshConnectionsCard({
  connections,
  busy,
  testStatus = {},
  onCreate,
  onUpdate,
  onRemove,
  onTest,
}: SshConnectionsCardProps) {
  const [label, setLabel] = useState('');
  const [hostAlias, setHostAlias] = useState('');
  const [hostAliasTouched, setHostAliasTouched] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [editingAlias, setEditingAlias] = useState('');
  const [editingAliasTouched, setEditingAliasTouched] = useState(false);
  const hostAliasValidation = validateSshHostAliasInput(hostAlias);
  const editingAliasValidation = validateSshHostAliasInput(editingAlias);

  return (
    <article className="card ssh-connections-card" aria-labelledby="ssh-connections-heading">
      <header className="card-head">
        <div>
          <span>LOCAL SSH</span>
          <h2 id="ssh-connections-heading">Registered server aliases</h2>
        </div>
        <small>{connections.length} available to Project Chat</small>
      </header>
      <p className="privacy">
        GOSU calls the system OpenSSH client with a host alias from your SSH config. Authentication
        stays in your SSH agent or existing config; passwords and private keys are never stored by
        this connection list.
      </p>

      <details>
        <summary>How to add an SSH server</summary>
        <p className="privacy">
          First add a named Host to <code>~/.ssh/config</code>, confirm{' '}
          <code>ssh research-gpu</code> works in Terminal, then enter only <code>research-gpu</code>{' '}
          below. Do not paste an entire command, <code>user@host</code>, <code>-p</code>, or{' '}
          <code>-L</code> here.
        </p>
        <pre>{`Host research-gpu
  HostName gpu.example.edu
  User researcher
  Port 2222`}</pre>
        <p className="privacy">
          Port forwarding remains outside GOSU. Project Chat can request only separately approved,
          read-only diagnostic commands.
        </p>
      </details>

      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          setHostAliasTouched(true);
          if (busy || !label.trim() || !hostAliasValidation.valid) return;
          void Promise.resolve()
            .then(() => onCreate({ label: label.trim(), hostAlias: hostAliasValidation.alias }))
            .then(
              (succeeded) => {
                if (succeeded === false) return;
                setLabel('');
                setHostAlias('');
                setHostAliasTouched(false);
              },
              () => undefined,
            );
        }}
      >
        <label>
          Server name
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={120}
            placeholder="Training server"
            required
            disabled={busy}
          />
        </label>
        <label>
          OpenSSH host alias
          <input
            value={hostAlias}
            onChange={(event) => {
              setHostAlias(event.target.value);
              setHostAliasTouched(true);
            }}
            onBlur={() => setHostAliasTouched(true)}
            maxLength={255}
            placeholder="research-gpu"
            title="Use one concrete Host alias from your SSH config, without user@, spaces, or options."
            aria-invalid={hostAliasTouched && !hostAliasValidation.valid}
            aria-describedby={
              hostAliasTouched && !hostAliasValidation.valid
                ? 'ssh-host-alias-help ssh-host-alias-error'
                : 'ssh-host-alias-help'
            }
            required
            disabled={busy}
          />
          <small id="ssh-host-alias-help">Alias only — example: research-gpu</small>
        </label>
        {hostAliasTouched && !hostAliasValidation.valid && (
          <p className="settings-validation" id="ssh-host-alias-error" role="alert">
            {hostAliasValidation.message}
          </p>
        )}
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !label.trim() || !hostAliasValidation.valid}
        >
          Register server
        </button>
      </form>

      <div className="connection-list">
        {connections.length === 0 ? (
          <div className="empty-card">
            <strong>No SSH server aliases registered</strong>
            <p>Add an alias already configured for non-interactive SSH Agent authentication.</p>
          </div>
        ) : (
          connections.map((connection) => {
            const editing = editingId === connection.id;
            return (
              <section className="connection-item" key={connection.id}>
                {editing ? (
                  <form
                    className="stack-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setEditingAliasTouched(true);
                      if (busy || !editingLabel.trim() || !editingAliasValidation.valid) return;
                      void Promise.resolve()
                        .then(() =>
                          onUpdate({
                            connectionId: connection.id,
                            expectedVersion: connection.version,
                            label: editingLabel.trim(),
                            hostAlias: editingAliasValidation.alias,
                          }),
                        )
                        .then(
                          (succeeded) => {
                            if (succeeded !== false) setEditingId(null);
                          },
                          () => undefined,
                        );
                    }}
                  >
                    <input
                      aria-label="Server name"
                      value={editingLabel}
                      onChange={(event) => setEditingLabel(event.target.value)}
                      maxLength={120}
                      disabled={busy}
                    />
                    <input
                      aria-label="OpenSSH host alias"
                      value={editingAlias}
                      onChange={(event) => {
                        setEditingAlias(event.target.value);
                        setEditingAliasTouched(true);
                      }}
                      onBlur={() => setEditingAliasTouched(true)}
                      maxLength={255}
                      aria-invalid={editingAliasTouched && !editingAliasValidation.valid}
                      aria-describedby={
                        editingAliasTouched && !editingAliasValidation.valid
                          ? `ssh-edit-alias-error-${connection.id}`
                          : undefined
                      }
                      disabled={busy}
                    />
                    {editingAliasTouched && !editingAliasValidation.valid && (
                      <p
                        className="settings-validation"
                        id={`ssh-edit-alias-error-${connection.id}`}
                        role="alert"
                      >
                        {editingAliasValidation.message}
                      </p>
                    )}
                    <div className="form-actions">
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={busy || !editingLabel.trim() || !editingAliasValidation.valid}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setEditingId(null);
                          setEditingAliasTouched(false);
                        }}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div>
                      <strong>{connection.label}</strong>
                      <span>{connection.hostAlias}</span>
                      <small>
                        {testStatus[connection.id] ?? `Connection profile v${connection.version}`}
                      </small>
                    </div>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => invokeWithoutUnhandledRejection(() => onTest(connection.id))}
                        disabled={busy}
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setEditingId(connection.id);
                          setEditingLabel(connection.label);
                          setEditingAlias(connection.hostAlias);
                          setEditingAliasTouched(false);
                        }}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost-button danger"
                        onClick={() =>
                          invokeWithoutUnhandledRejection(() =>
                            onRemove({
                              connectionId: connection.id,
                              expectedVersion: connection.version,
                            }),
                          )
                        }
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </section>
            );
          })
        )}
      </div>
      <p className="privacy">
        Project Chat can request a typed remote command, but every command waits for a separate
        Allow once decision. Raw output is returned only to that active model turn and is not saved
        as a tool payload; a summary the model writes in its visible answer becomes chat history.
        GOSU only permits a fixed read-only diagnostics allowlist and disables scripts, mutation,
        interactive shells, privilege escalation, file transfer, TTY, and forwarding. The OpenSSH
        alias still uses your trusted local SSH configuration.
      </p>
    </article>
  );
}
