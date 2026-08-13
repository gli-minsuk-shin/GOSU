import { useState } from 'react';

import {
  buildLectureStudioTrashTargets,
  EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION,
  type EmptyLectureStudioTrashInput,
  type EmptyLectureStudioTrashReceipt,
  type LectureStudioListSnapshot,
  type LectureStudioVersionCommand,
} from '../../shared/lecture-studio-contracts';
import {
  EMPTY_PROJECT_TRASH_CONFIRMATION,
  type EmptyProjectTrashInput,
  type EmptyProjectTrashReceipt,
  type ProjectVersionCommand,
  type SetTaskArchivedInput,
  type WorkspaceSnapshot,
} from '../../shared/workspace-contracts';

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function TrashSettingsSection({
  workspaceSnapshot,
  lectureSnapshot,
  lectureState,
  onRetryLectureTrash,
  busy,
  onRestoreProject,
  onEmptyProjectTrash,
  onRestoreLectureStudio,
  onEmptyLectureStudioTrash,
  onRestoreTask,
}: {
  workspaceSnapshot: WorkspaceSnapshot | null;
  lectureSnapshot: LectureStudioListSnapshot | null;
  lectureState: 'idle' | 'loading' | 'ready' | 'error';
  onRetryLectureTrash: () => void;
  busy: boolean;
  onRestoreProject: (input: ProjectVersionCommand) => Promise<boolean>;
  onEmptyProjectTrash: (input: EmptyProjectTrashInput) => Promise<EmptyProjectTrashReceipt | null>;
  onRestoreLectureStudio: (input: LectureStudioVersionCommand) => Promise<boolean>;
  onEmptyLectureStudioTrash: (
    input: EmptyLectureStudioTrashInput,
  ) => Promise<EmptyLectureStudioTrashReceipt | null>;
  onRestoreTask: (input: SetTaskArchivedInput) => Promise<boolean>;
}) {
  const [projectPhrase, setProjectPhrase] = useState('');
  const [projectReceipt, setProjectReceipt] = useState<EmptyProjectTrashReceipt | null>(null);
  const [lecturePhrase, setLecturePhrase] = useState('');
  const [lectureReceipt, setLectureReceipt] = useState<EmptyLectureStudioTrashReceipt | null>(null);
  const projects = workspaceSnapshot?.projects.filter((project) => project.trashedAt) ?? [];
  const lectures = lectureSnapshot?.studios.filter((studio) => studio.trashedAt) ?? [];
  const projectById = new Map(
    workspaceSnapshot?.projects.map((project) => [project.id, project] as const) ?? [],
  );
  const tasks =
    workspaceSnapshot?.tasks.filter((task) => {
      const project = projectById.get(task.projectId);
      return Boolean(task.archivedAt && project && !project.trashedAt);
    }) ?? [];
  const totalItems = projects.length + lectures.length + tasks.length;
  const allSnapshotsLoaded = workspaceSnapshot !== null && lectureState === 'ready';

  return (
    <div className="settings-layout project-settings-layout">
      <article className="settings-card">
        <div className="settings-card-heading">
          <span>TRASH</span>
          <h2>Recoverable items</h2>
          <p>
            Restore projects, Lecture Studios, and Board tasks from one place. Permanent removal
            remains separated by item type so each existing safety confirmation stays explicit.
          </p>
        </div>
        <div className="settings-template-callout" role="status">
          <strong>
            {countLabel(totalItems, 'item')} {allSnapshotsLoaded ? 'in Trash' : 'currently shown'}
          </strong>
          <span>
            {workspaceSnapshot ? countLabel(projects.length, 'project') : 'Projects loading'} ·{' '}
            {lectureState === 'ready'
              ? countLabel(lectures.length, 'Lecture Studio')
              : lectureState === 'error'
                ? 'Lecture Studios unavailable'
                : 'Lecture Studios loading'}{' '}
            · {workspaceSnapshot ? countLabel(tasks.length, 'Board task') : 'Board tasks loading'}
          </span>
        </div>
      </article>

      <article className="settings-card">
        <div className="settings-card-heading">
          <span>PROJECTS</span>
          <h2>Projects in Trash</h2>
          <p>
            Restoring keeps the same project ID, Board, goals, and local history. Active and
            archived projects are never included when this section is emptied.
          </p>
        </div>
        {!workspaceSnapshot ? (
          <div className="settings-empty-row">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="settings-empty-row">No projects in Trash.</div>
        ) : (
          <div className="project-settings-list">
            {projects.map((project) => {
              const taskCount = workspaceSnapshot.tasks.filter(
                (task) => task.projectId === project.id,
              ).length;
              const objectiveCount = workspaceSnapshot.objectives.filter(
                (objective) => objective.projectId === project.id,
              ).length;
              return (
                <section className="project-settings-row trashed" key={project.id}>
                  <div className="project-settings-summary">
                    <strong>{project.name}</strong>
                    <span>
                      Trashed {new Date(project.trashedAt!).toLocaleString()} · {taskCount} tasks ·{' '}
                      {objectiveCount} objective revisions preserved
                    </span>
                  </div>
                  <div className="project-settings-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void onRestoreProject({
                          projectId: project.id,
                          expectedVersion: project.version,
                        })
                      }
                    >
                      Restore
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {workspaceSnapshot && projects.length > 0 && (
          <section className="project-empty-trash" aria-label="Permanently remove trashed projects">
            <div className="settings-template-callout">
              <strong>External research data is preserved</strong>
              <span>
                GitHub repositories, local worktrees, Research Notes files, and remote server data
                are not deleted. Project links are detached and cannot be restored in GOSU.
              </span>
              <span>
                If a Lecture Studio still references one of these projects, permanently remove that
                Studio in the section below first, or restore the project instead.
              </span>
            </div>
            <label>
              Type {EMPTY_PROJECT_TRASH_CONFIRMATION} to permanently remove all projects shown here
              <input
                value={projectPhrase}
                onChange={(event) => setProjectPhrase(event.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            </label>
            <button
              type="button"
              className="danger-button"
              disabled={busy || projectPhrase !== EMPTY_PROJECT_TRASH_CONFIRMATION}
              onClick={() => {
                if (projectPhrase !== EMPTY_PROJECT_TRASH_CONFIRMATION) return;
                if (
                  !window.confirm(
                    `Final warning (2 of 2): permanently remove ${projects.length} project${projects.length === 1 ? '' : 's'} from GOSU? External repositories, Research Notes files, and remote server data will be preserved. This cannot be undone in GOSU.`,
                  )
                ) {
                  return;
                }
                void onEmptyProjectTrash({
                  expectedWorkspaceRevision: workspaceSnapshot.revision,
                  idempotencyKey: window.crypto.randomUUID(),
                  confirmation: EMPTY_PROJECT_TRASH_CONFIRMATION,
                }).then((receipt) => {
                  if (!receipt) return;
                  setProjectPhrase('');
                  setProjectReceipt(receipt);
                });
              }}
            >
              Permanently remove trashed projects
            </button>
          </section>
        )}
        {projectReceipt && (
          <section className="settings-template-callout project-trash-receipt" role="status">
            <strong>
              Removed {projectReceipt.removedProjects.length} project
              {projectReceipt.removedProjects.length === 1 ? '' : 's'} from GOSU
            </strong>
            <span>
              External research data and immutable provenance were preserved. Completed{' '}
              {new Date(projectReceipt.completedAt).toLocaleString()}.
            </span>
          </section>
        )}
      </article>

      <article className="settings-card">
        <div className="settings-card-heading">
          <span>LECTURE STUDIOS</span>
          <h2>Lecture Studios in Trash</h2>
          <p>
            Restore a Studio with the same ID, chat, source manifest, and revision history. Research
            Notes and generated files remain on disk.
          </p>
        </div>
        {lectureState === 'error' ? (
          <div className="settings-empty-row trash-load-error" role="alert">
            <span>
              Lecture Studios could not be loaded. Projects and Board tasks remain usable.
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={onRetryLectureTrash}
            >
              Retry
            </button>
          </div>
        ) : lectureState !== 'ready' || !lectureSnapshot ? (
          <div className="settings-empty-row">Loading Lecture Studios…</div>
        ) : lectures.length === 0 ? (
          <div className="settings-empty-row">No Lecture Studios in Trash.</div>
        ) : (
          <div className="project-settings-list">
            {lectures.map((studio) => (
              <section className="project-settings-row trashed" key={studio.id}>
                <div className="project-settings-summary">
                  <strong>{studio.title}</strong>
                  <span>
                    Trashed {new Date(studio.trashedAt!).toLocaleString()} · revision{' '}
                    {studio.currentRevision} · {studio.kind === 'talk' ? 'talk slides' : 'lecture'}
                  </span>
                </div>
                <div className="project-settings-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void onRestoreLectureStudio({
                        studioId: studio.id,
                        expectedVersion: studio.version,
                      })
                    }
                  >
                    Restore
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
        {lectureState === 'ready' && lectureSnapshot && lectures.length > 0 && (
          <section
            className="project-empty-trash"
            aria-label="Permanently remove trashed Lecture Studios"
          >
            <p>
              Permanent removal applies only to the Lecture Studios shown here; it does not empty
              project or Board task items.
            </p>
            <label>
              Type {EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION} to continue
              <input
                value={lecturePhrase}
                onChange={(event) => setLecturePhrase(event.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            </label>
            <button
              type="button"
              className="danger-button"
              disabled={busy || lecturePhrase !== EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION}
              onClick={() => {
                if (lecturePhrase !== EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION) return;
                if (
                  !window.confirm(
                    `Final warning (2 of 2): permanently remove ${lectures.length} Lecture Studio${lectures.length === 1 ? '' : 's'} from GOSU? Research Notes and exported files remain on disk. This cannot be undone in GOSU.`,
                  )
                ) {
                  return;
                }
                void onEmptyLectureStudioTrash({
                  idempotencyKey: window.crypto.randomUUID(),
                  confirmation: EMPTY_LECTURE_STUDIO_TRASH_CONFIRMATION,
                  targets: buildLectureStudioTrashTargets(lectures),
                }).then((receipt) => {
                  if (!receipt) return;
                  setLecturePhrase('');
                  setLectureReceipt(receipt);
                });
              }}
            >
              Permanently remove trashed Lecture Studios
            </button>
          </section>
        )}
        {lectureReceipt && (
          <section className="settings-template-callout project-trash-receipt" role="status">
            <strong>
              Removed {lectureReceipt.removedStudios.length} Lecture Studio
              {lectureReceipt.removedStudios.length === 1 ? '' : 's'} from GOSU
            </strong>
            <span>
              Research Notes and exported files were preserved. Completed{' '}
              {new Date(lectureReceipt.completedAt).toLocaleString()}.
            </span>
          </section>
        )}
      </article>

      <article className="settings-card">
        <div className="settings-card-heading">
          <span>BOARD TASKS</span>
          <h2>Deleted Board tasks</h2>
          <p>
            Board tasks can be restored here. GOSU does not currently permanently purge individual
            tasks. A task is removed from the workspace only when its trashed parent project is
            permanently removed above; its immutable project provenance remains preserved.
          </p>
        </div>
        {!workspaceSnapshot ? (
          <div className="settings-empty-row">Loading Board tasks…</div>
        ) : tasks.length === 0 ? (
          <div className="settings-empty-row">No deleted Board tasks.</div>
        ) : (
          <div className="project-settings-list">
            {tasks.map((task) => {
              const project = projectById.get(task.projectId);
              const projectIsActive = Boolean(project && !project.archivedAt && !project.trashedAt);
              return (
                <section className="project-settings-row trashed" key={task.id}>
                  <div className="project-settings-summary">
                    <strong>{task.title}</strong>
                    <span>
                      {project?.name ?? 'Unavailable project'} · deleted{' '}
                      {new Date(task.archivedAt!).toLocaleString()}
                      {!projectIsActive && ' · restore the parent project to Active first'}
                    </span>
                    {!projectIsActive && (
                      <span id={`trash-task-help-${task.id}`} className="settings-inline-help">
                        Parent project is archived. Restore it to Active in Projects before
                        restoring this task.
                      </span>
                    )}
                  </div>
                  <div className="project-settings-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || !projectIsActive}
                      aria-describedby={projectIsActive ? undefined : `trash-task-help-${task.id}`}
                      title={
                        projectIsActive
                          ? undefined
                          : 'Restore the parent project to active projects first'
                      }
                      onClick={() =>
                        void onRestoreTask({
                          projectId: task.projectId,
                          taskId: task.id,
                          expectedVersion: task.version,
                          archived: false,
                        })
                      }
                    >
                      Restore
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
