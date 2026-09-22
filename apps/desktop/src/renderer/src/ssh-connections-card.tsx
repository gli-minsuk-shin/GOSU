import { uiText, useUiText } from '@gosu/ui/language';

import { useState } from 'react';

import type {
  CreateSshConnectionInput,
  ImportSshCommandInput,
  RemoveSshConnectionInput,
  SshConnectionProfile,
  UpdateSshConnectionInput,
} from '../../shared/ssh-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import { SshResourceSummary, type SshResourceUiState } from './ssh-resource-summary';
import { SshAgentNoteEditor } from './ssh-agent-note-editor';

type MaybePromise<T> = T | Promise<T>;
const EMPTY_LINKED_CONNECTION_IDS: ReadonlySet<string> = new Set();
const EMPTY_RESOURCE_STATES: Readonly<Record<string, SshResourceUiState>> = {};

const SSH_HOST_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function canEditSshHostAlias(connection: SshConnectionProfile) {
  return !connection.directTarget;
}

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
      ? ' A supported -L value will be saved as an inactive loopback forwarding plan.'
      : '';
    return {
      valid: false,
      reason: 'ssh-command',
      message:
        'Paste this full command into “Paste an SSH connection command” above, or enter only a Host alias here.' +
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
  onImport: (input: ImportSshCommandInput) => MaybePromise<unknown>;
  onUpdate: (input: UpdateSshConnectionInput) => MaybePromise<unknown>;
  onRemove: (input: RemoveSshConnectionInput) => MaybePromise<unknown>;
  onTest: (connectionId: string) => MaybePromise<unknown>;
  activeProject?: ProjectRecord | null;
  projects?: readonly ProjectRecord[];
  linkedConnectionIds?: ReadonlySet<string>;
  linkedProjectIdsByConnectionId?: Readonly<Record<string, readonly string[]>>;
  resourceStates?: Readonly<Record<string, SshResourceUiState>>;
  onRefreshResource?: (connectionId: string) => MaybePromise<unknown>;
  onOpenWorkspaceSetup?: (projectId: string, connectionId: string) => void;
}>;

export function SshProjectLinkControl({
  connectionId,
  activeProject,
  projects,
  linkedProjectIds,
  busy,
  onOpenWorkspaceSetup,
}: Readonly<{
  connectionId: string;
  activeProject: ProjectRecord | null;
  projects: readonly ProjectRecord[];
  linkedProjectIds: ReadonlySet<string>;
  busy: boolean;
  onOpenWorkspaceSetup: (projectId: string, connectionId: string) => void;
}>) {
  const linkedProjects = projects.filter((project) => linkedProjectIds.has(project.id));
  const availableProjects = projects.filter((project) => !linkedProjectIds.has(project.id));
  const preferredProject =
    availableProjects.find((project) => project.id === activeProject?.id) ?? availableProjects[0];

  if (projects.length === 0) {
    return (
      <button
        type="button"
        className="secondary-button"
        disabled
        title={uiText('Open an active project to link')}
      >
        {uiText('No active project to link')}
      </button>
    );
  }

  return (
    <div className="ssh-project-link-control">
      {linkedProjects.length > 0 && (
        <div
          className="ssh-project-link-badges"
          aria-label={uiText('Projects linked to this server: {value1}', {
            value1: linkedProjects.map((project) => project.name).join(', '),
          })}
        >
          {linkedProjects.map((project) => (
            <button
              type="button"
              className="ssh-project-link-badge"
              key={project.id}
              onClick={() => onOpenWorkspaceSetup(project.id, connectionId)}
              disabled={busy}
              title={uiText('Manage {name} remote workspace grant', { name: project.name })}
            >
              {uiText('Linked to')} {project.name}
            </button>
          ))}
        </div>
      )}
      {availableProjects.length === 0 ? (
        <small className="ssh-project-link-complete">
          {uiText('Linked to all active projects')}
        </small>
      ) : availableProjects.length === 1 && preferredProject ? (
        <button
          type="button"
          className="secondary-button"
          onClick={() => onOpenWorkspaceSetup(preferredProject.id, connectionId)}
          disabled={busy}
        >
          {uiText('Link to')} {preferredProject.name}…
        </button>
      ) : (
        <form
          className="ssh-project-link-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const projectId = new FormData(event.currentTarget).get('projectId');
            if (typeof projectId === 'string' && projectId) {
              onOpenWorkspaceSetup(projectId, connectionId);
            }
          }}
        >
          <label>
            <span>{uiText('Link another project')}</span>
            <select name="projectId" defaultValue={preferredProject?.id} disabled={busy}>
              {availableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary-button" disabled={busy || !preferredProject}>
            {uiText('Link project…')}
          </button>
        </form>
      )}
    </div>
  );
}

export function SshConnectionsCard({
  connections,
  busy,
  testStatus = {},
  onCreate,
  onImport,
  onUpdate,
  onRemove,
  onTest,
  activeProject = null,
  projects,
  linkedConnectionIds = EMPTY_LINKED_CONNECTION_IDS,
  linkedProjectIdsByConnectionId = {},
  resourceStates = EMPTY_RESOURCE_STATES,
  onRefreshResource = () => undefined,
  onOpenWorkspaceSetup = () => undefined,
}: SshConnectionsCardProps) {
  useUiText();
  const [label, setLabel] = useState('');
  const [hostAlias, setHostAlias] = useState('');
  const [hostAliasTouched, setHostAliasTouched] = useState(false);
  const [importLabel, setImportLabel] = useState('');
  const [importCommand, setImportCommand] = useState('');
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
          <span>{uiText('LOCAL SSH')}</span>
          <h2 id="ssh-connections-heading">{uiText('Registered SSH servers')}</h2>
        </div>
        <small>
          {connections.length} {uiText('registered locally')}
        </small>
      </header>
      <p className="privacy">
        {uiText(
          'GOSU calls the system OpenSSH client with a registered alias or a safely parsed destination. Authentication stays in your SSH agent; passwords, private keys, and pasted command text are never stored by this connection list.',
        )}
      </p>

      <div className="connection-list">
        {connections.length === 0 ? (
          <div className="empty-card">
            <strong>{uiText('No SSH servers registered')}</strong>
            <p>{uiText('Paste a connection command or add an existing OpenSSH Host alias.')}</p>
          </div>
        ) : (
          connections.map((connection) => {
            const editing = editingId === connection.id;
            const availableProjects = projects ?? (activeProject ? [activeProject] : []);
            const linkedProjectIds = new Set(
              linkedProjectIdsByConnectionId[connection.id] ??
                (activeProject && linkedConnectionIds.has(connection.id) ? [activeProject.id] : []),
            );
            const resourceState = resourceStates[connection.id] ?? { phase: 'idle' };
            return (
              <section className="connection-item" key={connection.id}>
                {editing ? (
                  <form
                    className="stack-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setEditingAliasTouched(true);
                      if (
                        busy ||
                        !editingLabel.trim() ||
                        (canEditSshHostAlias(connection) && !editingAliasValidation.valid)
                      ) {
                        return;
                      }
                      void Promise.resolve()
                        .then(() =>
                          onUpdate({
                            connectionId: connection.id,
                            expectedVersion: connection.version,
                            label: editingLabel.trim(),
                            hostAlias: !canEditSshHostAlias(connection)
                              ? connection.hostAlias
                              : editingAliasValidation.valid
                                ? editingAliasValidation.alias
                                : connection.hostAlias,
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
                      aria-label={uiText('Server name')}
                      value={editingLabel}
                      onChange={(event) => setEditingLabel(event.target.value)}
                      maxLength={120}
                      disabled={busy}
                    />
                    {!canEditSshHostAlias(connection) && connection.directTarget ? (
                      <p className="privacy">
                        {uiText('Direct target ·')}{' '}
                        {connection.directTarget.user ? `${connection.directTarget.user}@` : ''}
                        {connection.directTarget.host}
                        {connection.directTarget.port ? `:${connection.directTarget.port}` : ''}
                        {uiText('. Re-import an SSH command to change this target.')}
                      </p>
                    ) : (
                      <input
                        aria-label={uiText('OpenSSH host alias')}
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
                    )}
                    {canEditSshHostAlias(connection) &&
                      editingAliasTouched &&
                      !editingAliasValidation.valid && (
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
                        disabled={
                          busy ||
                          !editingLabel.trim() ||
                          (canEditSshHostAlias(connection) && !editingAliasValidation.valid)
                        }
                      >
                        {uiText('Save')}
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
                        {uiText('Cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="ssh-connection-details">
                      <strong>{connection.label}</strong>
                      <span>
                        {connection.directTarget
                          ? `${connection.directTarget.user ? `${connection.directTarget.user}@` : ''}${connection.directTarget.host.includes(':') ? `[${connection.directTarget.host}]` : connection.directTarget.host}${connection.directTarget.port ? `:${connection.directTarget.port}` : ''}`
                          : connection.hostAlias}
                      </span>
                      {connection.directTarget?.localForwards.map((forward) => (
                        <small key={`${forward.bindAddress}:${forward.localPort}`}>
                          {uiText('Inactive tunnel ·')} {forward.bindAddress}:{forward.localPort} →{' '}
                          {forward.destinationHost}:{forward.destinationPort}
                        </small>
                      ))}
                      {connection.directTarget?.user === 'root' && (
                        <small>{uiText('Root login · HIGH RISK for remote workspace work')}</small>
                      )}
                      <small>
                        {testStatus[connection.id] ??
                          uiText('Connection profile v{version}', { version: connection.version })}
                      </small>
                      <small>
                        {uiText(
                          'Test checks host trust and non-interactive authentication only. Project linking and command Allow once approval are separate.',
                        )}
                      </small>
                    </div>
                    <SshResourceSummary state={resourceState} serverLabel={connection.label} />
                    <div className="form-actions">
                      <SshProjectLinkControl
                        connectionId={connection.id}
                        activeProject={activeProject}
                        projects={availableProjects}
                        linkedProjectIds={linkedProjectIds}
                        busy={busy}
                        onOpenWorkspaceSetup={onOpenWorkspaceSetup}
                      />
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          invokeWithoutUnhandledRejection(() => onRefreshResource(connection.id))
                        }
                        disabled={busy || resourceState.phase === 'loading'}
                      >
                        {resourceState.phase === 'loading'
                          ? uiText('Refreshing…')
                          : uiText('Refresh usage')}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => invokeWithoutUnhandledRejection(() => onTest(connection.id))}
                        disabled={busy}
                      >
                        {uiText('Test')}
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
                        {uiText('Edit')}
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
                        {uiText('Remove')}
                      </button>
                    </div>
                    <SshAgentNoteEditor
                      connectionId={connection.id}
                      serverLabel={connection.label}
                      disabled={busy}
                    />
                  </>
                )}
              </section>
            );
          })
        )}
      </div>

      <details>
        <summary>{uiText('How to add an SSH server')}</summary>
        <p className="privacy">
          {uiText(
            'You can paste a narrow connection command in the importer below. GOSU accepts only',
          )}{' '}
          <code>{uiText('ssh')}</code>, <code>-p</code>, <code>-l</code>
          {uiText(', one destination, and loopback-only')} <code>-L</code>
          {uiText('. It never executes the pasted text. Alternatively, add a named Host to')}{' '}
          <code>{uiText('~/.ssh/config')}</code>
          {uiText(', confirm')} <code>{uiText('ssh research-gpu')}</code>{' '}
          {uiText('works in Terminal, then enter only')} <code>{uiText('research-gpu')}</code>{' '}
          {uiText('in the alias form.')}
        </p>
        <pre>
          {uiText('Host research-gpu\n  HostName gpu.example.edu\n  User researcher\n  Port 2222')}
        </pre>
        <p className="privacy">
          {uiText('Imported')} <code>-L</code>{' '}
          {uiText(
            'requests are stored as an inactive normalized plan. Project Chat does not open a tunnel automatically and can request only separately approved commands.',
          )}
        </p>
      </details>

      <form
        className="stack-form ssh-command-import-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !importCommand.trim()) return;
          void Promise.resolve()
            .then(() =>
              onImport({
                command: importCommand.trim(),
                ...(importLabel.trim() ? { label: importLabel.trim() } : {}),
              }),
            )
            .then(
              (succeeded) => {
                if (succeeded === false) return;
                setImportLabel('');
                setImportCommand('');
              },
              () => undefined,
            );
        }}
      >
        <strong>{uiText('Paste an SSH connection command')}</strong>
        <label>
          {uiText('Server name · optional')}
          <input
            value={importLabel}
            onChange={(event) => setImportLabel(event.target.value)}
            maxLength={120}
            placeholder={uiText('8× RTX 3080')}
            disabled={busy}
          />
        </label>
        <label>
          {uiText('SSH command')}
          <textarea
            value={importCommand}
            onChange={(event) => setImportCommand(event.target.value)}
            maxLength={4096}
            rows={3}
            spellCheck={false}
            placeholder={uiText('ssh -p 2222 researcher@203.0.113.10 -L 8080:localhost:8080')}
            required
            disabled={busy}
          />
        </label>
        <p className="privacy">
          {uiText(
            'The parser runs locally without an LLM or shell. Generic options, key paths, proxy commands, remote commands, and shell syntax are rejected. A root login requires a separate project workspace grant and is marked HIGH RISK for every approval.',
          )}
        </p>
        <button type="submit" className="primary-button" disabled={busy || !importCommand.trim()}>
          {uiText('Parse and register')}
        </button>
      </form>

      <div className="ssh-registration-divider" role="separator">
        <span>{uiText('or register an existing ~/.ssh/config alias')}</span>
      </div>

      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          setHostAliasTouched(true);
          if (busy || !label.trim() || !hostAliasValidation.valid) return;
          void Promise.resolve()
            .then(() =>
              onCreate({
                label: label.trim(),
                hostAlias: hostAliasValidation.alias,
              }),
            )
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
          {uiText('Server name')}
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={120}
            placeholder={uiText('Training server')}
            required
            disabled={busy}
          />
        </label>
        <label>
          {uiText('OpenSSH host alias')}
          <input
            value={hostAlias}
            onChange={(event) => {
              setHostAlias(event.target.value);
              setHostAliasTouched(true);
            }}
            onBlur={() => setHostAliasTouched(true)}
            maxLength={255}
            placeholder={uiText('research-gpu')}
            title={uiText(
              'Use one concrete Host alias from your SSH config, without user@, spaces, or options.',
            )}
            aria-invalid={hostAliasTouched && !hostAliasValidation.valid}
            aria-describedby={
              hostAliasTouched && !hostAliasValidation.valid
                ? 'ssh-host-alias-help ssh-host-alias-error'
                : 'ssh-host-alias-help'
            }
            required
            disabled={busy}
          />
          <small id="ssh-host-alias-help">{uiText('Alias only — example: research-gpu')}</small>
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
          {uiText('Register server')}
        </button>
      </form>

      <p className="privacy">
        {uiText(
          "Project Chat can request a typed remote command, but every command waits for a separate Allow once decision. Raw output is returned only to that active model turn and is not saved as a tool payload; a summary the model writes in its visible answer becomes chat history. Registered servers remain unavailable to a project until a separate workspace grant is approved. Diagnostics grants permit bounded Git inspection; Workspace grants may additionally list/read bounded text files, create a new text file, replace an unchanged text file, run a strict direct-argv test/build allowlist, and run one foreground Python experiment entrypoint for at most 120 seconds. Every file action and command requires Allow once. The typed broker itself has no deletion, raw shell, inline eval, module launch, interactive shell, privilege escalation, general file transfer, TTY, or forwarding action. Approved Python, tests, and builds are still untrusted code with the SSH account's full accessible privileges; the workspace path does not sandbox that code. Parsed destinations use isolated, non-interactive OpenSSH options.",
        )}
      </p>
    </article>
  );
}
