import { useState } from 'react';

import type {
  ProjectRecord,
  ProjectVersionCommand,
  RenameProjectInput,
  SetProjectArchivedInput,
  WorkspaceSnapshot,
} from '../../shared/workspace-contracts';

type ProjectMutation = (input: ProjectVersionCommand) => Promise<boolean>;

export function ProjectSettingsSection({
  snapshot,
  busyAction,
  chatBusyProjectIds,
  onRenameProject,
  onSetProjectArchived,
  onTrashProject,
  onRestoreProject,
}: {
  snapshot: WorkspaceSnapshot | null;
  busyAction: string | null;
  chatBusyProjectIds: ReadonlySet<string>;
  onRenameProject: (input: RenameProjectInput) => Promise<boolean>;
  onSetProjectArchived: (input: SetProjectArchivedInput) => Promise<boolean>;
  onTrashProject: ProjectMutation;
  onRestoreProject: ProjectMutation;
}) {
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [trashCandidateId, setTrashCandidateId] = useState<string | null>(null);
  const [trashName, setTrashName] = useState('');

  if (!snapshot) {
    return (
      <article className="settings-card">
        <div className="settings-card-heading">
          <span>PROJECTS</span>
          <h2>Local workspace unavailable</h2>
          <p>
            Appearance and Board defaults still work. Retry the workspace before managing projects.
          </p>
        </div>
      </article>
    );
  }

  const activeProjects = snapshot.projects.filter(
    (project) => project.trashedAt === undefined && project.archivedAt === undefined,
  );
  const archivedProjects = snapshot.projects.filter(
    (project) => project.trashedAt === undefined && project.archivedAt !== undefined,
  );
  const trashedProjects = snapshot.projects.filter((project) => project.trashedAt !== undefined);
  const trashCandidate = [...activeProjects, ...archivedProjects].find(
    (project) => project.id === trashCandidateId,
  );

  const preservedCounts = (projectId: string) => ({
    tasks: snapshot.tasks.filter((task) => task.projectId === projectId).length,
    objectiveVersions: snapshot.objectives.filter((objective) => objective.projectId === projectId)
      .length,
  });

  const closeTrashConfirmation = () => {
    setTrashCandidateId(null);
    setTrashName('');
  };

  return (
    <div className="settings-layout project-settings-layout">
      <article className="settings-card">
        <div className="settings-card-heading">
          <span>ACTIVE PROJECTS</span>
          <h2>Rename, archive, or move a project to Trash</h2>
          <p>
            Archive pauses normal work while keeping the project easy to restore. Trash is a
            separate, recoverable step with two warnings. Renaming keeps the stable project slug.
          </p>
        </div>
        {activeProjects.length === 0 ? (
          <div className="settings-empty-row">
            No active projects. Create one or restore it below.
          </div>
        ) : (
          <div className="project-settings-list">
            {activeProjects.map((project) => {
              const counts = preservedCounts(project.id);
              const isRenaming = renamingProjectId === project.id;
              const chatBusy = chatBusyProjectIds.has(project.id);
              return (
                <section className="project-settings-row" key={project.id}>
                  <div className="project-settings-summary">
                    <strong>{project.name}</strong>
                    <span>
                      {counts.tasks} tasks · {counts.objectiveVersions} objective revisions · stable
                      slug {project.slug}
                    </span>
                  </div>
                  {isRenaming ? (
                    <form
                      className="project-rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const name = renameDraft.trim();
                        if (name.length < 2 || busyAction !== null) return;
                        void onRenameProject({
                          projectId: project.id,
                          expectedVersion: project.version,
                          name,
                        }).then((succeeded) => {
                          if (succeeded) setRenamingProjectId(null);
                        });
                      }}
                    >
                      <input
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        minLength={2}
                        maxLength={120}
                        aria-label={`New name for ${project.name}`}
                        autoFocus
                        required
                        disabled={busyAction !== null}
                      />
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={busyAction !== null || renameDraft.trim().length < 2}
                      >
                        Save name
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setRenamingProjectId(null)}
                        disabled={busyAction !== null}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="project-settings-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setRenamingProjectId(project.id);
                          setRenameDraft(project.name);
                          closeTrashConfirmation();
                        }}
                        disabled={busyAction !== null}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          void onSetProjectArchived({
                            projectId: project.id,
                            expectedVersion: project.version,
                            archived: true,
                          })
                        }
                        disabled={busyAction !== null || chatBusy}
                        title={
                          chatBusy ? 'Stop or wait for the active Codex turn first' : undefined
                        }
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => {
                          setTrashCandidateId(project.id);
                          setTrashName('');
                          setRenamingProjectId(null);
                        }}
                        disabled={busyAction !== null || chatBusy}
                        title={
                          chatBusy ? 'Stop or wait for the active Codex turn first' : undefined
                        }
                      >
                        Move to Trash
                      </button>
                    </div>
                  )}
                  {chatBusy && (
                    <p className="project-settings-warning">
                      Stop or wait for this project's active Codex turn before archiving it or
                      moving it to Trash.
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </article>

      {trashCandidate && (
        <article className="settings-card project-trash-confirmation" role="alertdialog">
          <div className="settings-card-heading">
            <span>WARNING 1 OF 2</span>
            <h2>Move “{trashCandidate.name}” to Trash?</h2>
            <p>
              The project will disappear from the switcher, but its tasks, objectives, Board,
              project chat, and action provenance stay locally preserved. You can restore it below.
            </p>
          </div>
          <label>
            Type the exact project name to continue
            <input
              value={trashName}
              onChange={(event) => setTrashName(event.target.value)}
              autoFocus
              autoComplete="off"
              disabled={busyAction !== null}
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="danger-button"
              disabled={trashName !== trashCandidate.name || busyAction !== null}
              onClick={() => {
                if (trashName !== trashCandidate.name) return;
                const confirmed = window.confirm(
                  `Final warning (2 of 2): move “${trashCandidate.name}” to recoverable Trash?`,
                );
                if (!confirmed) return;
                void onTrashProject({
                  projectId: trashCandidate.id,
                  expectedVersion: trashCandidate.version,
                }).then((succeeded) => {
                  if (succeeded) closeTrashConfirmation();
                });
              }}
            >
              Continue to final warning
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={closeTrashConfirmation}
              disabled={busyAction !== null}
            >
              Cancel
            </button>
          </div>
        </article>
      )}

      <article className="settings-card">
        <div className="settings-card-heading">
          <span>ARCHIVED</span>
          <h2>Paused projects</h2>
          <p>
            Archived projects keep their Board, goals, notes, and chat history. Restore one to
            active before changing it or asking its AI agent to work.
          </p>
        </div>
        {archivedProjects.length === 0 ? (
          <div className="settings-empty-row">No archived projects.</div>
        ) : (
          <div className="project-settings-list">
            {archivedProjects.map((project) => {
              const counts = preservedCounts(project.id);
              return (
                <section className="project-settings-row archived" key={project.id}>
                  <div className="project-settings-summary">
                    <strong>{project.name}</strong>
                    <span>
                      Archived{' '}
                      {project.archivedAt
                        ? new Date(project.archivedAt).toLocaleString()
                        : 'locally'}{' '}
                      · {counts.tasks} tasks · {counts.objectiveVersions} objective revisions
                      preserved
                    </span>
                  </div>
                  <div className="project-settings-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        void onSetProjectArchived({
                          projectId: project.id,
                          expectedVersion: project.version,
                          archived: false,
                        })
                      }
                    >
                      Restore to active
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={busyAction !== null}
                      onClick={() => {
                        setTrashCandidateId(project.id);
                        setTrashName('');
                        setRenamingProjectId(null);
                      }}
                    >
                      Move to Trash
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </article>

      <article className="settings-card">
        <div className="settings-card-heading">
          <span>TRASH</span>
          <h2>Recoverable projects</h2>
          <p>
            GOSU does not permanently delete projects in this MVP. Restoring brings back the same
            project ID and all preserved local work. A project archived before Trash returns to its
            archived state.
          </p>
        </div>
        {trashedProjects.length === 0 ? (
          <div className="settings-empty-row">Trash is empty.</div>
        ) : (
          <div className="project-settings-list">
            {trashedProjects.map((project) => (
              <TrashedProjectRow
                key={project.id}
                project={project}
                counts={preservedCounts(project.id)}
                busy={busyAction !== null}
                onRestore={onRestoreProject}
              />
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

function TrashedProjectRow({
  project,
  counts,
  busy,
  onRestore,
}: {
  project: ProjectRecord;
  counts: Readonly<{ tasks: number; objectiveVersions: number }>;
  busy: boolean;
  onRestore: ProjectMutation;
}) {
  return (
    <section className="project-settings-row trashed">
      <div className="project-settings-summary">
        <strong>{project.name}</strong>
        <span>
          Trashed {project.trashedAt ? new Date(project.trashedAt).toLocaleString() : 'locally'} ·{' '}
          {counts.tasks} tasks · {counts.objectiveVersions} objective revisions preserved
        </span>
      </div>
      <div className="project-settings-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void onRestore({ projectId: project.id, expectedVersion: project.version })
          }
        >
          Restore
        </button>
      </div>
    </section>
  );
}
