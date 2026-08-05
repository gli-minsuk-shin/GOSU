import { useEffect, useMemo, useState } from 'react';

import type { SshConnectionProfile } from '../../shared/ssh-contracts';
import type {
  CreateRemoteWorkspaceGrantInput,
  GrantedRemoteWorkspace,
  RemoveRemoteWorkspaceGrantInput,
  UpdateRemoteWorkspaceGrantInput,
} from '../../shared/ssh-workspace-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';

type MaybePromise<T> = T | Promise<T>;

export type SshWorkspaceGrantsCardProps = Readonly<{
  project: ProjectRecord | null;
  connections: readonly SshConnectionProfile[];
  workspaces: readonly GrantedRemoteWorkspace[];
  busy: boolean;
  onCreate: (input: CreateRemoteWorkspaceGrantInput) => MaybePromise<unknown>;
  onUpdate: (input: UpdateRemoteWorkspaceGrantInput) => MaybePromise<unknown>;
  onRemove: (input: RemoveRemoteWorkspaceGrantInput) => MaybePromise<unknown>;
}>;

export function SshWorkspaceGrantsCard({
  project,
  connections,
  workspaces,
  busy,
  onCreate,
  onUpdate,
  onRemove,
}: SshWorkspaceGrantsCardProps) {
  const [connectionId, setConnectionId] = useState('');
  const [canonicalRoot, setCanonicalRoot] = useState('');
  const [permissionMode, setPermissionMode] = useState<'diagnostics' | 'workspace'>('diagnostics');
  const [confirmed, setConfirmed] = useState(false);
  const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
  const selectedConnection = connections.find((connection) => connection.id === connectionId);
  const editingWorkspace = workspaces.find(({ grant }) => grant.id === editingGrantId);
  const grantedConnectionIds = useMemo(
    () => new Set(workspaces.map(({ grant }) => grant.connectionId)),
    [workspaces],
  );
  const availableConnections = connections.filter(
    (connection) =>
      connection.id === editingWorkspace?.connection.id || !grantedConnectionIds.has(connection.id),
  );

  useEffect(() => {
    setEditingGrantId(null);
    setConnectionId('');
    setCanonicalRoot('');
    setPermissionMode('diagnostics');
    setConfirmed(false);
  }, [project?.id]);

  const reset = () => {
    setEditingGrantId(null);
    setConnectionId('');
    setCanonicalRoot('');
    setPermissionMode('diagnostics');
    setConfirmed(false);
  };

  return (
    <article className="card ssh-workspace-card" aria-labelledby="ssh-workspace-heading">
      <header className="card-head">
        <div>
          <span>PROJECT-SCOPED SSH</span>
          <h2 id="ssh-workspace-heading">Remote workspace access</h2>
        </div>
        <small>
          {project ? `${workspaces.length} granted to ${project.name}` : 'Select a project'}
        </small>
      </header>
      <p className="privacy">
        A registered server is not automatically available to every project. Grant one canonical
        workspace root to the active project, then Project Chat can request only bounded direct-argv
        commands. Every command still requires a separate Allow once decision.
      </p>
      {!project ? (
        <div className="empty-card">
          <strong>No active project</strong>
          <p>Open a project, then return here to grant its remote workspace.</p>
        </div>
      ) : (
        <>
          <form
            className="stack-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !connectionId || !canonicalRoot.trim() || !confirmed) return;
              const operation = editingWorkspace
                ? onUpdate({
                    grantId: editingWorkspace.grant.id,
                    projectId: project.id,
                    expectedVersion: editingWorkspace.grant.version,
                    canonicalRoot: canonicalRoot.trim(),
                    permissionMode,
                    confirmWorkspaceRisk: true,
                  })
                : onCreate({
                    projectId: project.id,
                    connectionId,
                    canonicalRoot: canonicalRoot.trim(),
                    permissionMode,
                    confirmWorkspaceRisk: true,
                  });
              void Promise.resolve(operation).then(
                (succeeded) => {
                  if (succeeded !== false) reset();
                },
                () => undefined,
              );
            }}
          >
            <label>
              Registered server
              <select
                value={connectionId}
                onChange={(event) => {
                  const nextConnectionId = event.target.value;
                  setConnectionId(nextConnectionId);
                  if (
                    !connections.find((connection) => connection.id === nextConnectionId)
                      ?.directTarget
                  ) {
                    setPermissionMode('diagnostics');
                  }
                  setConfirmed(false);
                }}
                disabled={busy || Boolean(editingWorkspace)}
                required
              >
                <option value="">Choose a server</option>
                {availableConnections.map((connection) => (
                  <option value={connection.id} key={connection.id}>
                    {connection.label}
                    {connection.directTarget?.user === 'root' ? ' · ROOT' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Canonical remote workspace root
              <input
                value={canonicalRoot}
                onChange={(event) => {
                  setCanonicalRoot(event.target.value);
                  setConfirmed(false);
                }}
                maxLength={1024}
                placeholder="/root/my-research-project"
                spellCheck={false}
                required
                disabled={busy}
              />
              <small>
                Use a specific project directory. `/`, `/root`, and system directories are blocked.
              </small>
            </label>
            <label>
              Permission mode
              <select
                value={permissionMode}
                onChange={(event) => {
                  setPermissionMode(event.target.value as 'diagnostics' | 'workspace');
                  setConfirmed(false);
                }}
                disabled={busy}
              >
                <option value="diagnostics">Diagnostics · Git inspection only</option>
                <option value="workspace" disabled={!selectedConnection?.directTarget}>
                  Workspace · inspection plus approved tests/builds
                  {!selectedConnection?.directTarget ? ' · paste a direct SSH command first' : ''}
                </option>
              </select>
            </label>
            <label className="settings-check-row ssh-workspace-risk-confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={busy}
              />
              <span>
                I understand this is an advisory policy boundary, not a remote sandbox. Tests and
                builds may execute repository code with the SSH account’s privileges.
                {selectedConnection?.directTarget?.user === 'root'
                  ? ' HIGH RISK: this selected account is root.'
                  : !selectedConnection?.directTarget?.user
                    ? ' HIGH RISK: the effective account privilege is unknown.'
                    : ''}
              </span>
            </label>
            <div className="form-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={busy || !connectionId || !canonicalRoot.trim() || !confirmed}
              >
                {editingWorkspace ? 'Update project grant' : 'Grant project access'}
              </button>
              {editingWorkspace && (
                <button type="button" className="ghost-button" onClick={reset} disabled={busy}>
                  Cancel
                </button>
              )}
            </div>
          </form>
          <div className="connection-list">
            {workspaces.length === 0 ? (
              <div className="empty-card">
                <strong>No remote workspace granted</strong>
                <p>Registered servers remain unavailable to this project until you opt in here.</p>
              </div>
            ) : (
              workspaces.map(({ grant, connection }) => (
                <section className="connection-item" key={grant.id}>
                  <div>
                    <strong>{connection.label}</strong>
                    <span>{grant.canonicalRoot}</span>
                    <small>
                      {grant.permissionMode === 'workspace'
                        ? 'Workspace · inspection and approved tests/builds'
                        : 'Diagnostics · Git inspection only'}{' '}
                      · grant v{grant.version}
                    </small>
                    {connection.directTarget?.user === 'root' && (
                      <strong className="ssh-root-warning">HIGH RISK · ROOT account</strong>
                    )}
                  </div>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        setEditingGrantId(grant.id);
                        setConnectionId(connection.id);
                        setCanonicalRoot(grant.canonicalRoot);
                        setPermissionMode(grant.permissionMode);
                        setConfirmed(false);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost-button danger"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Revoke ${connection.label} from ${project.name}?`))
                          return;
                        void Promise.resolve(
                          onRemove({
                            grantId: grant.id,
                            projectId: project.id,
                            expectedVersion: grant.version,
                          }),
                        ).catch(() => undefined);
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                </section>
              ))
            )}
          </div>
        </>
      )}
    </article>
  );
}
