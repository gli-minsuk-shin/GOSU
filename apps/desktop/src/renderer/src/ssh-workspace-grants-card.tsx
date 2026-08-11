import { useEffect, useMemo, useRef, useState } from 'react';

import type { SshConnectionProfile } from '../../shared/ssh-contracts';
import type {
  CreateRemoteWorkspaceGrantInput,
  GrantedRemoteWorkspace,
  RemoveRemoteWorkspaceGrantInput,
  UpdateRemoteWorkspaceGrantInput,
} from '../../shared/ssh-workspace-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';

type MaybePromise<T> = T | Promise<T>;

export type SshWorkspaceSetupRequest = Readonly<{
  requestId: number;
  projectId: string;
  connectionId: string | null;
}>;

export function resolveSshWorkspaceSetupConnectionId(
  requestedConnectionId: string | null,
  availableConnectionIds: readonly string[],
) {
  if (requestedConnectionId) {
    return availableConnectionIds.includes(requestedConnectionId) ? requestedConnectionId : '';
  }
  return availableConnectionIds.length === 1 ? (availableConnectionIds[0] ?? '') : '';
}

export type SshWorkspaceSetupTarget =
  | Readonly<{ kind: 'edit'; workspace: GrantedRemoteWorkspace }>
  | Readonly<{ kind: 'create'; connectionId: string }>;

export function resolveSshWorkspaceSetupTarget(
  requestedConnectionId: string | null,
  availableConnectionIds: readonly string[],
  workspaces: readonly GrantedRemoteWorkspace[],
): SshWorkspaceSetupTarget {
  const existingWorkspace = requestedConnectionId
    ? workspaces.find(({ connection }) => connection.id === requestedConnectionId)
    : undefined;
  if (existingWorkspace) return { kind: 'edit', workspace: existingWorkspace };
  return {
    kind: 'create',
    connectionId: resolveSshWorkspaceSetupConnectionId(
      requestedConnectionId,
      availableConnectionIds,
    ),
  };
}

export function shouldHandleSshWorkspaceSetupRequest(
  request: SshWorkspaceSetupRequest | null,
  activeProjectId: string | null,
  handledRequestId: number,
) {
  return Boolean(
    request &&
    activeProjectId &&
    request.projectId === activeProjectId &&
    request.requestId > handledRequestId,
  );
}

export function acknowledgeSshWorkspaceSetupRequest(
  current: SshWorkspaceSetupRequest | null,
  handledRequestId: number,
) {
  return current?.requestId === handledRequestId ? null : current;
}

export type SshWorkspaceGrantsCardProps = Readonly<{
  project: ProjectRecord | null;
  connections: readonly SshConnectionProfile[];
  workspaces: readonly GrantedRemoteWorkspace[];
  workspaceReady?: boolean;
  busy: boolean;
  onCreate: (input: CreateRemoteWorkspaceGrantInput) => MaybePromise<unknown>;
  onUpdate: (input: UpdateRemoteWorkspaceGrantInput) => MaybePromise<unknown>;
  onRemove: (input: RemoveRemoteWorkspaceGrantInput) => MaybePromise<unknown>;
  onTest?: (connectionId: string) => MaybePromise<unknown>;
  testStatus?: Readonly<Record<string, string>>;
  setupRequest?: SshWorkspaceSetupRequest | null;
  onSetupRequestHandled?: (requestId: number) => void;
}>;

export function SshWorkspaceGrantsCard({
  project,
  connections,
  workspaces,
  workspaceReady = true,
  busy,
  onCreate,
  onUpdate,
  onRemove,
  onTest,
  testStatus = {},
  setupRequest = null,
  onSetupRequestHandled = () => undefined,
}: SshWorkspaceGrantsCardProps) {
  const [connectionId, setConnectionId] = useState('');
  const [canonicalRoot, setCanonicalRoot] = useState('');
  const [permissionMode, setPermissionMode] = useState<'diagnostics' | 'workspace'>('diagnostics');
  const [confirmed, setConfirmed] = useState(false);
  const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
  const handledSetupRequestIdRef = useRef(0);
  const cardRef = useRef<HTMLElement>(null);
  const connectionSelectRef = useRef<HTMLSelectElement>(null);
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

  useEffect(() => {
    if (
      !project ||
      !setupRequest ||
      !workspaceReady ||
      !shouldHandleSshWorkspaceSetupRequest(
        setupRequest,
        project.id,
        handledSetupRequestIdRef.current,
      ) ||
      connections.length === 0
    ) {
      return;
    }
    const target = resolveSshWorkspaceSetupTarget(
      setupRequest.connectionId,
      availableConnections.map((connection) => connection.id),
      workspaces,
    );
    handledSetupRequestIdRef.current = setupRequest.requestId;
    onSetupRequestHandled(setupRequest.requestId);
    if (target.kind === 'edit') {
      setEditingGrantId(target.workspace.grant.id);
      setConnectionId(target.workspace.connection.id);
      setCanonicalRoot(target.workspace.grant.canonicalRoot);
      setPermissionMode(target.workspace.grant.permissionMode);
    } else {
      setEditingGrantId(null);
      setConnectionId(target.connectionId);
      setCanonicalRoot('');
      setPermissionMode('diagnostics');
    }
    setConfirmed(false);
    window.requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      connectionSelectRef.current?.focus({ preventScroll: true });
    });
  }, [
    availableConnections,
    connections.length,
    onSetupRequestHandled,
    project,
    setupRequest,
    workspaceReady,
    workspaces,
  ]);

  const reset = () => {
    setEditingGrantId(null);
    setConnectionId('');
    setCanonicalRoot('');
    setPermissionMode('diagnostics');
    setConfirmed(false);
  };

  return (
    <article
      className="card ssh-workspace-card"
      aria-labelledby="ssh-workspace-heading"
      ref={cardRef}
    >
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
        workspace root to the active project, then Project Chat can request bounded text file
        listing, reading, creation, and replacement plus approved direct-argv commands. By default,
        every command and file action requires a separate Allow once decision. Project Chat can
        explicitly enable audited Trusted workspace access for an exact non-root Workspace grant; it
        removes repeated prompts but never adds raw shell, secrets, privileged operations,
        outside-grant paths, or remote deletion.
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
                ref={connectionSelectRef}
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
            {selectedConnection && onTest && (
              <div className="ssh-workspace-connection-check">
                <span>{testStatus[selectedConnection.id] ?? 'Not tested in this session'}</span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    void Promise.resolve(onTest(selectedConnection.id)).catch(() => undefined);
                  }}
                >
                  Test selected server
                </button>
              </div>
            )}
            <label>
              Canonical remote workspace root
              <input
                value={canonicalRoot}
                onChange={(event) => {
                  setCanonicalRoot(event.target.value);
                  setConfirmed(false);
                }}
                maxLength={1024}
                placeholder={`/root/${project.slug || 'my-research-project'}`}
                spellCheck={false}
                required
                disabled={busy}
              />
              <small>
                Enter an existing project directory on this server. `/`, `/root`, and system
                directories are blocked.
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
                  Workspace · approved text files, tests/builds, and foreground Python experiments
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
                I understand this is an advisory policy boundary, not a remote sandbox. Tests,
                builds, and foreground Python experiments may execute repository code with the SSH
                account’s privileges and may access or change anything that account can reach.
                Approved typed text file creates and replacements change the workspace; the typed
                file broker does not provide remote deletion.
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
                        ? 'Workspace · inspection, approved tests/builds, and foreground Python experiments; approved text file list/read/create/replace'
                        : 'Diagnostics · Git inspection only'}{' '}
                      · grant v{grant.version}
                    </small>
                    {connection.directTarget?.user === 'root' && (
                      <strong className="ssh-root-warning">HIGH RISK · ROOT account</strong>
                    )}
                    {onTest && (
                      <small>{testStatus[connection.id] ?? 'Not tested in this session'}</small>
                    )}
                  </div>
                  <div className="form-actions">
                    {onTest && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => {
                          void Promise.resolve(onTest(connection.id)).catch(() => undefined);
                        }}
                      >
                        Test server
                      </button>
                    )}
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
