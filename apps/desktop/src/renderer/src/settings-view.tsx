import { useState } from 'react';

import type {
  CodexCollaborationModeDescriptor,
  ProjectChatProfile,
  UpdateProjectChatProfileInput,
} from '../../shared/project-chat-contracts';
import type {
  EmptyProjectTrashInput,
  EmptyProjectTrashReceipt,
  ProjectRecord,
  ProjectVersionCommand,
  RenameProjectInput,
  SetProjectArchivedInput,
  SetTaskArchivedInput,
  WorkspaceSnapshot,
} from '../../shared/workspace-contracts';
import type { VaultSelection } from '../../shared/vault-contracts';
import {
  LectureStudioStructureTemplateSchema,
  type EmptyLectureStudioTrashInput,
  type EmptyLectureStudioTrashReceipt,
  type LectureStudioListSnapshot,
  type LectureStudioVersionCommand,
} from '../../shared/lecture-studio-contracts';
import type { SaveOverleafPersonalTokenInput } from '../../shared/overleaf-personal-token-contracts';
import {
  AgentAddOnsSection,
  type HermesProjectChatConnectionUiState,
} from './agent-addons-section';
import { AgentSettingsSection } from './agent-settings-section';
import { AiDefaultSettings } from './ai-default-settings';
import { BoardSettingsForm } from './board-settings-form';
import {
  LectureStructureEditor,
  lectureStructureEditorValidation,
} from './lecture-structure-editor';
import type { CodexModel } from './connections-view';
import type { VaultRuntimeState } from './notes-view';
import { OverleafPersonalTokenSettings } from './overleaf-personal-token-settings';
import type { OverleafPersonalTokenUiState } from './overleaf-personal-token-ui';
import { ProjectSettingsSection } from './project-settings-section';
import { TrashSettingsSection } from './trash-settings-section';
import { SSH_RESOURCE_REFRESH_INTERVAL_OPTIONS } from './ssh-resource-refresh-policy';
import {
  type AppearancePreference,
  type TextSizePreference,
  type UserPreferences,
} from './user-preferences';

const APPEARANCE_CHOICES: ReadonlyArray<{
  id: AppearancePreference;
  label: string;
  description: string;
  icon: string;
}> = [
  { id: 'system', label: 'System', description: 'Follow this Mac', icon: '◐' },
  { id: 'dark', label: 'Dark', description: 'Low-light workspace', icon: '●' },
  { id: 'light', label: 'Light', description: 'Bright workspace', icon: '○' },
];

const TEXT_SIZE_CHOICES: ReadonlyArray<{
  id: TextSizePreference;
  label: string;
  description: string;
  sample: string;
}> = [
  { id: 'compact', label: 'Compact', description: '12 px base', sample: 'Aa' },
  { id: 'default', label: 'Default', description: '14 px base', sample: 'Aa' },
  { id: 'large', label: 'Large', description: '16 px base', sample: 'Aa' },
  { id: 'extra-large', label: 'Extra large', description: '18 px base', sample: 'Aa' },
];

export type SettingsCategory =
  'appearance' | 'board' | 'lecture' | 'projects' | 'trash' | 'overleaf' | 'servers' | 'agent';

export function SettingsView({
  preferences,
  onChange,
  workspaceSnapshot,
  busyAction,
  chatBusyProjectIds,
  onRenameProject,
  onSetProjectArchived,
  onTrashProject,
  onRestoreProject,
  onEmptyProjectTrash,
  lectureTrashSnapshot,
  lectureTrashState,
  onRetryLectureTrash,
  onRestoreLectureStudio,
  onEmptyLectureStudioTrash,
  onRestoreTask,
  overleafPersonalTokenState,
  onRefreshOverleafPersonalToken,
  onSaveOverleafPersonalToken,
  onRemoveOverleafPersonalToken,
  models,
  modelsLoading,
  onRefreshModels,
  initialCategory = 'appearance',
  category,
  onCategoryChange,
  agentProject,
  agentProfile,
  agentProfileLoading,
  collaborationModes,
  vault,
  vaultState,
  onUpdateAgentProfile,
  hermesConnection,
  onRefreshHermesConnection,
}: {
  preferences: UserPreferences;
  onChange: (preferences: UserPreferences) => void;
  workspaceSnapshot: WorkspaceSnapshot | null;
  busyAction: string | null;
  chatBusyProjectIds: ReadonlySet<string>;
  onRenameProject: (input: RenameProjectInput) => Promise<boolean>;
  onSetProjectArchived: (input: SetProjectArchivedInput) => Promise<boolean>;
  onTrashProject: (input: ProjectVersionCommand) => Promise<boolean>;
  onRestoreProject: (input: ProjectVersionCommand) => Promise<boolean>;
  onEmptyProjectTrash: (input: EmptyProjectTrashInput) => Promise<EmptyProjectTrashReceipt | null>;
  lectureTrashSnapshot: LectureStudioListSnapshot | null;
  lectureTrashState: 'idle' | 'loading' | 'ready' | 'error';
  onRetryLectureTrash: () => void;
  onRestoreLectureStudio: (input: LectureStudioVersionCommand) => Promise<boolean>;
  onEmptyLectureStudioTrash: (
    input: EmptyLectureStudioTrashInput,
  ) => Promise<EmptyLectureStudioTrashReceipt | null>;
  onRestoreTask: (input: SetTaskArchivedInput) => Promise<boolean>;
  overleafPersonalTokenState: OverleafPersonalTokenUiState;
  onRefreshOverleafPersonalToken: () => Promise<void>;
  onSaveOverleafPersonalToken: (input: SaveOverleafPersonalTokenInput) => Promise<void>;
  onRemoveOverleafPersonalToken: () => Promise<void>;
  models: readonly CodexModel[];
  modelsLoading: boolean;
  onRefreshModels: () => void | Promise<void>;
  initialCategory?: SettingsCategory;
  category?: SettingsCategory;
  onCategoryChange?: (category: SettingsCategory) => void;
  agentProject: ProjectRecord | undefined;
  agentProfile: ProjectChatProfile | undefined;
  agentProfileLoading: boolean;
  collaborationModes: readonly CodexCollaborationModeDescriptor[];
  vault: VaultSelection | null;
  vaultState: VaultRuntimeState;
  onUpdateAgentProfile: (input: UpdateProjectChatProfileInput) => Promise<boolean>;
  hermesConnection?: HermesProjectChatConnectionUiState;
  onRefreshHermesConnection?: () => Promise<unknown>;
}) {
  const [localCategory, setLocalCategory] = useState<SettingsCategory>(initialCategory);
  const [lectureStructureDraft, setLectureStructureDraft] = useState(() =>
    structuredClone(preferences.defaultLectureStructure),
  );
  const activeCategory = category ?? localCategory;
  const lectureStructureDirty =
    JSON.stringify(lectureStructureDraft) !== JSON.stringify(preferences.defaultLectureStructure);
  const lectureStructureValid = lectureStructureEditorValidation(lectureStructureDraft).valid;
  const selectCategory = (nextCategory: SettingsCategory) => {
    setLocalCategory(nextCategory);
    onCategoryChange?.(nextCategory);
  };

  return (
    <section className="settings-shell" aria-label="Application settings">
      <nav className="settings-category-nav" aria-label="Settings categories">
        <button
          type="button"
          className={activeCategory === 'appearance' ? 'active' : ''}
          aria-current={activeCategory === 'appearance' ? 'page' : undefined}
          onClick={() => selectCategory('appearance')}
        >
          <i aria-hidden="true">◐</i>
          <strong>Appearance</strong>
          <span>Theme and font size</span>
        </button>
        <button
          type="button"
          className={activeCategory === 'board' ? 'active' : ''}
          aria-current={activeCategory === 'board' ? 'page' : undefined}
          onClick={() => selectCategory('board')}
        >
          <i aria-hidden="true">▦</i>
          <strong>Board defaults</strong>
          <span>New project template</span>
        </button>
        <button
          type="button"
          className={activeCategory === 'lecture' ? 'active' : ''}
          aria-current={activeCategory === 'lecture' ? 'page' : undefined}
          onClick={() => selectCategory('lecture')}
        >
          <i aria-hidden="true">▤</i>
          <strong>Lecture defaults</strong>
          <span>Notes &amp; slides structure</span>
        </button>
        <button
          type="button"
          className={activeCategory === 'projects' ? 'active' : ''}
          aria-current={activeCategory === 'projects' ? 'page' : undefined}
          onClick={() => selectCategory('projects')}
        >
          <i aria-hidden="true">◇</i>
          <strong>Projects</strong>
          <span>Rename, archive, move to Trash</span>
        </button>
        <button
          type="button"
          className={activeCategory === 'trash' ? 'active' : ''}
          aria-current={activeCategory === 'trash' ? 'page' : undefined}
          onClick={() => selectCategory('trash')}
        >
          <i aria-hidden="true">♲</i>
          <strong>Trash</strong>
          <span>Restore or permanently remove</span>
        </button>
        <button
          type="button"
          className={activeCategory === 'overleaf' ? 'active' : ''}
          aria-current={activeCategory === 'overleaf' ? 'page' : undefined}
          onClick={() => selectCategory('overleaf')}
        >
          <i aria-hidden="true">OL</i>
          <strong>Overleaf</strong>
          <span>Personal Git token</span>
        </button>
        <button
          type="button"
          className={activeCategory === 'servers' ? 'active' : ''}
          aria-current={activeCategory === 'servers' ? 'page' : undefined}
          onClick={() => selectCategory('servers')}
        >
          <i aria-hidden="true">⌁</i>
          <strong>Servers</strong>
          <span>Status refresh interval</span>
        </button>
        <button
          type="button"
          className={activeCategory === 'agent' ? 'active' : ''}
          aria-current={activeCategory === 'agent' ? 'page' : undefined}
          onClick={() => selectCategory('agent')}
        >
          <i aria-hidden="true">✦</i>
          <strong>AI Agent</strong>
          <span>Defaults, native mode, project prompt</span>
        </button>
      </nav>

      <div className="settings-category-content">
        {activeCategory === 'appearance' ? (
          <div className="settings-layout">
            <article className="settings-card">
              <div className="settings-card-heading">
                <span>APPEARANCE</span>
                <h2>Choose how GOSU looks</h2>
                <p>System follows the light or dark appearance selected in macOS.</p>
              </div>
              <div
                className="preference-options appearance-options"
                role="group"
                aria-label="Appearance"
              >
                {APPEARANCE_CHOICES.map((choice) => (
                  <button
                    type="button"
                    className={preferences.appearance === choice.id ? 'selected' : ''}
                    aria-pressed={preferences.appearance === choice.id}
                    key={choice.id}
                    onClick={() => onChange({ ...preferences, appearance: choice.id })}
                  >
                    <i aria-hidden="true">{choice.icon}</i>
                    <strong>{choice.label}</strong>
                    <span>{choice.description}</span>
                  </button>
                ))}
              </div>
            </article>

            <article className="settings-card">
              <div className="settings-card-heading">
                <span>FONT SIZE</span>
                <h2>Make every workspace comfortable to read</h2>
                <p>
                  The change applies immediately across chat, Board, forms, rendered notes, and
                  navigation.
                </p>
              </div>
              <div
                className="preference-options text-size-options"
                role="group"
                aria-label="Font size"
              >
                {TEXT_SIZE_CHOICES.map((choice) => (
                  <button
                    type="button"
                    className={`${preferences.textSize === choice.id ? 'selected' : ''} ${choice.id}`}
                    aria-pressed={preferences.textSize === choice.id}
                    key={choice.id}
                    onClick={() => onChange({ ...preferences, textSize: choice.id })}
                  >
                    <i aria-hidden="true">{choice.sample}</i>
                    <strong>{choice.label}</strong>
                    <span>{choice.description}</span>
                  </button>
                ))}
              </div>
              <div className="settings-preview">
                <span>LIVE PREVIEW</span>
                <h3>Readable research starts with comfortable text.</h3>
                <p>
                  GOSU keeps this preference on this Mac. It is not sent to Hosted Sync or included
                  in a project repository.
                </p>
              </div>
            </article>
          </div>
        ) : activeCategory === 'board' ? (
          <article className="settings-card default-board-template-card">
            <div className="settings-card-heading">
              <span>DEFAULT BOARD TEMPLATE</span>
              <h2>Choose the workflow for new projects</h2>
              <p>
                Rename Backlog and the other columns, reorder them, or set WIP limits. Saving this
                template affects only projects created afterward; existing project Boards stay
                unchanged.
              </p>
            </div>
            <div className="settings-template-callout">
              <strong>New project default</strong>
              <span>
                {preferences.defaultBoardTemplate.columnOrder
                  .map((status) => preferences.defaultBoardTemplate.columnLabels[status])
                  .join(' → ')}
              </span>
            </div>
            <BoardSettingsForm
              key={JSON.stringify(preferences.defaultBoardTemplate)}
              initial={preferences.defaultBoardTemplate}
              saveLabel="Save default template"
              onSave={(defaultBoardTemplate) => onChange({ ...preferences, defaultBoardTemplate })}
            />
          </article>
        ) : activeCategory === 'lecture' ? (
          <article className="settings-card lecture-default-structure-card">
            <div className="settings-card-heading">
              <span>LECTURE DEFAULTS</span>
              <h2>Choose the default content flow</h2>
              <p>
                Arrange the sections GOSU should use for new Lecture Studios. Slides follow the same
                order in a shorter form. Existing Studios and saved revisions do not change.
              </p>
            </div>
            <LectureStructureEditor
              value={lectureStructureDraft}
              onChange={setLectureStructureDraft}
              heading="Default notes & slides structure"
              idPrefix="settings-lecture-structure"
              contextCopy="This local default is copied into each new Studio. GOSU still manages document formatting, citations, the slide title page, and Sources used."
              onReset={() =>
                setLectureStructureDraft(structuredClone(preferences.defaultLectureStructure))
              }
              resetDisabled={!lectureStructureDirty}
              resetLabel="Revert changes"
            />
            <div className="settings-template-callout" role="status" aria-live="polite">
              <strong>{lectureStructureDirty ? 'Unsaved changes' : 'Current default'}</strong>
              <span>
                {lectureStructureDraft.mode === 'adaptive'
                  ? 'Adaptive to each Studio’s selected sources'
                  : `${lectureStructureDraft.sections.length} custom sections`}
              </span>
            </div>
            <div className="settings-form-actions">
              <button
                type="button"
                className="primary-button"
                disabled={!lectureStructureDirty || !lectureStructureValid}
                onClick={() => {
                  const normalized =
                    LectureStudioStructureTemplateSchema.safeParse(lectureStructureDraft);
                  if (!normalized.success) return;
                  setLectureStructureDraft(structuredClone(normalized.data));
                  onChange({
                    ...preferences,
                    defaultLectureStructure: structuredClone(normalized.data),
                  });
                }}
              >
                Save default structure
              </button>
            </div>
          </article>
        ) : activeCategory === 'projects' ? (
          <ProjectSettingsSection
            snapshot={workspaceSnapshot}
            busyAction={busyAction}
            chatBusyProjectIds={chatBusyProjectIds}
            onRenameProject={onRenameProject}
            onSetProjectArchived={onSetProjectArchived}
            onTrashProject={onTrashProject}
          />
        ) : activeCategory === 'trash' ? (
          <TrashSettingsSection
            workspaceSnapshot={workspaceSnapshot}
            lectureSnapshot={lectureTrashSnapshot}
            lectureState={lectureTrashState}
            onRetryLectureTrash={onRetryLectureTrash}
            busy={busyAction !== null}
            onRestoreProject={onRestoreProject}
            onEmptyProjectTrash={onEmptyProjectTrash}
            onRestoreLectureStudio={onRestoreLectureStudio}
            onEmptyLectureStudioTrash={onEmptyLectureStudioTrash}
            onRestoreTask={onRestoreTask}
          />
        ) : activeCategory === 'overleaf' ? (
          <OverleafPersonalTokenSettings
            state={overleafPersonalTokenState}
            onRefresh={onRefreshOverleafPersonalToken}
            onSave={onSaveOverleafPersonalToken}
            onRemove={onRemoveOverleafPersonalToken}
          />
        ) : activeCategory === 'servers' ? (
          <article className="settings-card server-monitoring-settings-card">
            <div className="settings-card-heading">
              <span>SERVER MONITORING</span>
              <h2>Choose how often server status refreshes</h2>
              <p>
                GOSU refreshes CPU, memory, and GPU usage only while Connections or Project Chat is
                visible. Manual refresh remains available beside every server.
              </p>
            </div>
            <div
              className="preference-options server-refresh-options"
              role="group"
              aria-label="Server status refresh interval"
            >
              {SSH_RESOURCE_REFRESH_INTERVAL_OPTIONS.map((choice) => (
                <button
                  type="button"
                  className={preferences.sshResourceRefreshInterval === choice.id ? 'selected' : ''}
                  aria-pressed={preferences.sshResourceRefreshInterval === choice.id}
                  key={choice.id}
                  onClick={() =>
                    onChange({ ...preferences, sshResourceRefreshInterval: choice.id })
                  }
                >
                  <i aria-hidden="true">{choice.id === 'manual' ? '↻' : '◷'}</i>
                  <strong>{choice.label}</strong>
                  <span>{choice.description}</span>
                </button>
              ))}
            </div>
            <div className="settings-preview server-refresh-preview">
              <span>LOCAL-ONLY PREFERENCE</span>
              <p>
                The selected schedule applies when you return to Connections or Project Chat. It
                does not alter the remote server or send monitoring data to Hosted Sync.
              </p>
            </div>
          </article>
        ) : (
          <>
            <AiDefaultSettings
              selection={preferences.defaultAiSelection}
              models={models}
              modelsLoading={modelsLoading}
              onRefreshModels={onRefreshModels}
              onSave={(defaultAiSelection) => onChange({ ...preferences, defaultAiSelection })}
            />
            <AgentAddOnsSection
              preferences={preferences.agentAddOns}
              onChange={(agentAddOns) => onChange({ ...preferences, agentAddOns })}
              {...(hermesConnection ? { hermesConnection } : {})}
              {...(onRefreshHermesConnection ? { onRefreshHermesConnection } : {})}
            />
            <AgentSettingsSection
              project={agentProject}
              profile={agentProfile}
              loading={agentProfileLoading}
              busy={
                busyAction !== null ||
                Boolean(agentProject && chatBusyProjectIds.has(agentProject.id))
              }
              collaborationModes={collaborationModes}
              vault={vault}
              vaultState={vaultState}
              onSave={onUpdateAgentProfile}
            />
          </>
        )}
      </div>
    </section>
  );
}
