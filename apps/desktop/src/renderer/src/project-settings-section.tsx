import { uiText, useUiText } from '@gosu/ui/language';

import { useState } from 'react';

import {
  type ProjectVersionCommand,
  type RenameProjectInput,
  type SetProjectArchivedInput,
  type WorkspaceSnapshot,
} from '../../shared/workspace-contracts';

type ProjectMutation = (input: ProjectVersionCommand) => Promise<boolean>;

export function ProjectSettingsSection({
  snapshot,
  busyAction,
  chatBusyProjectIds,
  onRenameProject,
  onSetProjectArchived,
  onTrashProject,
}: {
  snapshot: WorkspaceSnapshot | null;
  busyAction: string | null;
  chatBusyProjectIds: ReadonlySet<string>;
  onRenameProject: (input: RenameProjectInput) => Promise<boolean>;
  onSetProjectArchived: (input: SetProjectArchivedInput) => Promise<boolean>;
  onTrashProject: ProjectMutation;
}) {
  useUiText();
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [trashCandidateId, setTrashCandidateId] = useState<string | null>(null);
  const [trashName, setTrashName] = useState('');

  if (!snapshot) {
    return (
      <article className="settings-card">
        <div className="settings-card-heading">
          <span>{uiText('PROJECTS')}</span>
          <h2>{uiText('Local workspace unavailable')}</h2>
          <p>
            {uiText(
              'Appearance and Board defaults still work. Retry the workspace before managing projects.',
            )}
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
          <span>{uiText('ACTIVE PROJECTS')}</span>
          <h2>{uiText('Rename, archive, or move a project to Trash')}</h2>
          <p>
            {uiText(
              'Archive pauses normal work while keeping the project easy to restore. Trash is a separate, recoverable step with two warnings. Renaming keeps the stable project slug.',
            )}
          </p>
        </div>
        {activeProjects.length === 0 ? (
          <div className="settings-empty-row">
            {uiText('No active projects. Create one or restore it from Trash.')}
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
                      {counts.tasks} {uiText('tasks ·')} {counts.objectiveVersions}{' '}
                      {uiText('objective revisions · stable slug')} {project.slug}
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
                        aria-label={uiText('New name for {name}', { name: project.name })}
                        autoFocus
                        required
                        disabled={busyAction !== null}
                      />
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={busyAction !== null || renameDraft.trim().length < 2}
                      >
                        {uiText('Save name')}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setRenamingProjectId(null)}
                        disabled={busyAction !== null}
                      >
                        {uiText('Cancel')}
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
                        {uiText('Rename')}
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
                          chatBusy
                            ? uiText('Stop or wait for the active Codex turn first')
                            : undefined
                        }
                      >
                        {uiText('Archive')}
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
                          chatBusy
                            ? uiText('Stop or wait for the active Codex turn first')
                            : undefined
                        }
                      >
                        {uiText('Move to Trash')}
                      </button>
                    </div>
                  )}
                  {chatBusy && (
                    <p className="project-settings-warning">
                      {uiText(
                        "Stop or wait for this project's active Codex turn before archiving it or moving it to Trash.",
                      )}
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
            <span>{uiText('WARNING 1 OF 2')}</span>
            <h2>
              {uiText('Move “')}
              {trashCandidate.name}
              {uiText('” to Trash?')}
            </h2>
            <p>
              {uiText(
                'The project will disappear from the switcher, but its tasks, objectives, Board, project chat, and action provenance stay locally preserved. You can restore it below.',
              )}
            </p>
          </div>
          <label>
            {uiText('Type the exact project name to continue')}
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
                  uiText('Final warning (2 of 2): move “{name}” to recoverable Trash?', {
                    name: trashCandidate.name,
                  }),
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
              {uiText('Continue to final warning')}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={closeTrashConfirmation}
              disabled={busyAction !== null}
            >
              {uiText('Cancel')}
            </button>
          </div>
        </article>
      )}

      <article className="settings-card">
        <div className="settings-card-heading">
          <span>{uiText('ARCHIVED')}</span>
          <h2>{uiText('Paused projects')}</h2>
          <p>
            {uiText(
              'Archived projects keep their Board, goals, notes, and chat history. Restore one to active before changing it or asking its AI agent to work.',
            )}
          </p>
        </div>
        {archivedProjects.length === 0 ? (
          <div className="settings-empty-row">{uiText('No archived projects.')}</div>
        ) : (
          <div className="project-settings-list">
            {archivedProjects.map((project) => {
              const counts = preservedCounts(project.id);
              return (
                <section className="project-settings-row archived" key={project.id}>
                  <div className="project-settings-summary">
                    <strong>{project.name}</strong>
                    <span>
                      {uiText('Archived')}{' '}
                      {project.archivedAt
                        ? new Date(project.archivedAt).toLocaleString()
                        : uiText('locally')}{' '}
                      · {counts.tasks} {uiText('tasks ·')} {counts.objectiveVersions}{' '}
                      {uiText('objective revisions preserved')}
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
                      {uiText('Restore to active')}
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
                      {uiText('Move to Trash')}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </article>
    </div>
  );
}
