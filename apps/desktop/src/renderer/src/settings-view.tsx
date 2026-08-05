import { useState } from 'react';

import type {
  CodexCollaborationModeDescriptor,
  ProjectChatProfile,
  UpdateProjectChatProfileInput,
} from '../../shared/project-chat-contracts';
import type {
  ProjectRecord,
  ProjectVersionCommand,
  RenameProjectInput,
  SetProjectArchivedInput,
  WorkspaceSnapshot,
} from '../../shared/workspace-contracts';
import type { VaultSelection } from '../../shared/vault-contracts';
import { AgentAddOnsSection } from './agent-addons-section';
import { AgentSettingsSection } from './agent-settings-section';
import { BoardSettingsForm } from './board-settings-form';
import type { VaultRuntimeState } from './notes-view';
import { ProjectSettingsSection } from './project-settings-section';
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

export type SettingsCategory = 'appearance' | 'board' | 'projects' | 'agent';

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
}) {
  const [localCategory, setLocalCategory] = useState<SettingsCategory>(initialCategory);
  const activeCategory = category ?? localCategory;
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
          className={activeCategory === 'projects' ? 'active' : ''}
          aria-current={activeCategory === 'projects' ? 'page' : undefined}
          onClick={() => selectCategory('projects')}
        >
          <i aria-hidden="true">◇</i>
          <strong>Projects</strong>
          <span>Rename, archive, Trash, restore</span>
        </button>
        <button
          type="button"
          className={activeCategory === 'agent' ? 'active' : ''}
          aria-current={activeCategory === 'agent' ? 'page' : undefined}
          onClick={() => selectCategory('agent')}
        >
          <i aria-hidden="true">✦</i>
          <strong>AI Agent</strong>
          <span>Native Codex mode and project prompt</span>
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
        ) : activeCategory === 'projects' ? (
          <ProjectSettingsSection
            snapshot={workspaceSnapshot}
            busyAction={busyAction}
            chatBusyProjectIds={chatBusyProjectIds}
            onRenameProject={onRenameProject}
            onSetProjectArchived={onSetProjectArchived}
            onTrashProject={onTrashProject}
            onRestoreProject={onRestoreProject}
          />
        ) : (
          <>
            <AgentAddOnsSection
              preferences={preferences.agentAddOns}
              onChange={(agentAddOns) => onChange({ ...preferences, agentAddOns })}
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
