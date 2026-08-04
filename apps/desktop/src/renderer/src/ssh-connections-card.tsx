import { useState } from 'react';

import type {
  CreateSshConnectionInput,
  RemoveSshConnectionInput,
  SshConnectionProfile,
  UpdateSshConnectionInput,
} from '../../shared/ssh-contracts';

type MaybePromise<T> = T | Promise<T>;

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [editingAlias, setEditingAlias] = useState('');

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

      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !label.trim() || !hostAlias.trim()) return;
          void Promise.resolve()
            .then(() => onCreate({ label: label.trim(), hostAlias: hostAlias.trim() }))
            .then(
              (succeeded) => {
                if (succeeded === false) return;
                setLabel('');
                setHostAlias('');
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
            onChange={(event) => setHostAlias(event.target.value)}
            maxLength={255}
            pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
            placeholder="research-gpu"
            title="Use one concrete Host alias from your SSH config, without user@, spaces, or options."
            required
            disabled={busy}
          />
        </label>
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !label.trim() || !hostAlias.trim()}
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
                      if (busy || !editingLabel.trim() || !editingAlias.trim()) return;
                      void Promise.resolve()
                        .then(() =>
                          onUpdate({
                            connectionId: connection.id,
                            expectedVersion: connection.version,
                            label: editingLabel.trim(),
                            hostAlias: editingAlias.trim(),
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
                      onChange={(event) => setEditingAlias(event.target.value)}
                      maxLength={255}
                      pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
                      disabled={busy}
                    />
                    <div className="form-actions">
                      <button type="submit" className="primary-button" disabled={busy}>
                        Save
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setEditingId(null)}
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
