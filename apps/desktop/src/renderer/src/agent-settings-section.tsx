import { useEffect, useState } from 'react';

import {
  PROJECT_CHAT_MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  type LocalNotesVaultGrant,
  type ProjectChatContextScope,
  type ProjectChatHarnessMode,
  type ProjectChatProfile,
  type ProjectChatResponseDepth,
  type UpdateProjectChatProfileInput,
} from '../../shared/project-chat-contracts';
import type { VaultSelection } from '../../shared/vault-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import type { VaultRuntimeState } from './notes-view';

const HARNESS_CHOICES: ReadonlyArray<{
  id: ProjectChatHarnessMode;
  label: string;
  description: string;
}> = [
  {
    id: 'context',
    label: 'Research copilot',
    description: 'Discuss evidence and propose a Board change only when explicitly requested.',
  },
  {
    id: 'planner',
    label: 'Planner',
    description: 'Turn the current project state into concrete, reviewable next actions.',
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    description: 'Critique assumptions and gaps. GOSU enforces an empty action list.',
  },
];

const DEPTH_CHOICES: ReadonlyArray<{
  id: ProjectChatResponseDepth;
  label: string;
  description: string;
}> = [
  { id: 'concise', label: 'Concise', description: 'Decision-first answer' },
  { id: 'standard', label: 'Standard', description: 'Balanced detail' },
  { id: 'deep', label: 'Deep', description: 'Assumptions and tradeoffs' },
];

const CONTEXT_CHOICES: ReadonlyArray<{
  id: ProjectChatContextScope;
  label: string;
  description: string;
}> = [
  { id: 'project', label: 'Full project', description: 'Board + latest Objective' },
  { id: 'board', label: 'Board only', description: 'Workflow and active tasks' },
  { id: 'objective', label: 'Objective only', description: 'Goal, metric, guardrails, budget' },
];

export function AgentSettingsSection({
  project,
  profile,
  loading,
  busy,
  vault,
  vaultState,
  onSave,
}: {
  project: ProjectRecord | undefined;
  profile: ProjectChatProfile | undefined;
  loading: boolean;
  busy: boolean;
  vault: VaultSelection | null;
  vaultState: VaultRuntimeState;
  onSave: (input: UpdateProjectChatProfileInput) => Promise<boolean>;
}) {
  const [harnessMode, setHarnessMode] = useState<ProjectChatHarnessMode>('context');
  const [responseDepth, setResponseDepth] = useState<ProjectChatResponseDepth>('standard');
  const [contextScope, setContextScope] = useState<ProjectChatContextScope>('project');
  const [customInstructions, setCustomInstructions] = useState('');
  const [localNotesVault, setLocalNotesVault] = useState<LocalNotesVaultGrant | null>(null);

  useEffect(() => {
    setHarnessMode(profile?.harnessMode ?? 'context');
    setResponseDepth(profile?.responseDepth ?? 'standard');
    setContextScope(profile?.contextScope ?? 'project');
    setCustomInstructions(profile?.customInstructions ?? '');
    setLocalNotesVault(profile?.localNotesVault ?? null);
  }, [profile?.projectId, profile?.version]);

  if (!project) {
    return (
      <article className="settings-card">
        <div className="settings-card-heading">
          <span>AI AGENT</span>
          <h2>Create or restore a project first</h2>
          <p>
            Agent profiles are isolated per active project and stored in the encrypted local DB.
          </p>
        </div>
      </article>
    );
  }

  if (loading || !profile) {
    return (
      <article className="settings-card" aria-live="polite">
        <div className="settings-card-heading">
          <span>AI AGENT · {project.name}</span>
          <h2>Loading the encrypted project profile…</h2>
          <p>Board, appearance, and local notes remain available.</p>
        </div>
      </article>
    );
  }

  const hasChanges =
    harnessMode !== profile.harnessMode ||
    responseDepth !== profile.responseDepth ||
    contextScope !== profile.contextScope ||
    localNotesVault?.id !== profile.localNotesVault?.id ||
    localNotesVault?.name !== profile.localNotesVault?.name ||
    customInstructions !== profile.customInstructions;

  return (
    <form
      className="settings-layout agent-settings-layout"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !hasChanges) return;
        void onSave({
          projectId: project.id,
          expectedVersion: profile.version,
          harnessMode,
          responseDepth,
          contextScope,
          localNotesVault,
          customInstructions,
        });
      }}
    >
      <article className="settings-card">
        <div className="settings-card-heading">
          <span>AGENT HARNESS · {project.name}</span>
          <h2>Choose how the project copilot works</h2>
          <p>
            These modes change prompt assembly and allowed proposals. They do not grant tools or
            execution permissions.
          </p>
        </div>
        <div className="agent-choice-grid" role="radiogroup" aria-label="Agent harness mode">
          {HARNESS_CHOICES.map((choice) => (
            <button
              type="button"
              role="radio"
              aria-checked={harnessMode === choice.id}
              className={harnessMode === choice.id ? 'selected' : ''}
              key={choice.id}
              onClick={() => setHarnessMode(choice.id)}
              disabled={busy}
            >
              <strong>{choice.label}</strong>
              <span>{choice.description}</span>
            </button>
          ))}
        </div>
      </article>

      <article className="settings-card">
        <div className="settings-card-heading">
          <span>LOCAL NOTES ACCESS</span>
          <h2>Authorize research notes per project</h2>
          <p>
            The agent receives typed, read-only list and read tools. It never receives the Vault
            root, a raw path, shell access, or another project's grant.
          </p>
        </div>
        <div className="agent-notes-access">
          <div>
            <strong>
              {vaultState === 'checking'
                ? 'Checking Local Notes access…'
                : vaultState === 'unavailable'
                  ? 'Local Notes status unavailable'
                  : vault
                    ? vault.name
                    : 'No Local Notes folder selected'}
            </strong>
            <span>
              {vaultState === 'checking'
                ? 'Waiting for the authoritative Main-process Vault state.'
                : vaultState === 'unavailable'
                  ? 'GOSU could not verify the selected folder. Chats with a saved grant are paused.'
                  : vault
                    ? `${vault.files.length.toLocaleString()} Markdown files available locally`
                    : 'Open Local notes in the sidebar and choose a folder first.'}
            </span>
            {vaultState === 'ready' &&
              profile.localNotesVault &&
              profile.localNotesVault.id !== vault?.id && (
                <small>
                  The saved grant for {profile.localNotesVault.name} is inactive because the
                  selected folder changed. GOSU will not silently transfer access.
                </small>
              )}
          </div>
          <div className="agent-notes-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={
                vaultState !== 'ready' || !vault || busy || localNotesVault?.id === vault.id
              }
              onClick={() => vault && setLocalNotesVault({ id: vault.id, name: vault.name })}
            >
              {vault && localNotesVault?.id === vault.id
                ? profile.localNotesVault?.id === vault.id
                  ? 'Current folder authorized'
                  : 'Selected — save to authorize'
                : 'Authorize current folder'}
            </button>
            {localNotesVault && (
              <button
                type="button"
                className="ghost-button"
                disabled={busy}
                onClick={() => setLocalNotesVault(null)}
              >
                Remove access (save required)
              </button>
            )}
            {profile.localNotesVault && !localNotesVault && (
              <small>Removal pending — save the profile to revoke access.</small>
            )}
          </div>
        </div>
        <div className="agent-notes-disclosure">
          <strong>What leaves this Mac</strong>
          <span>
            Listing notes sends their display titles and opaque IDs to the configured Codex/LLM.
            Reading sends a bounded excerpt plus its content SHA-256, offset, and total character
            count for that turn. The model may quote or summarize this data in its visible answer.
            Visible chat is saved in this project's encrypted local database and is eligible for
            Hosted Sync. GOSU does not automatically store or sync the raw tool payload, Vault
            root/path, or source note file; it appends bounded source metadata to the answer.
          </span>
        </div>
      </article>

      <article className="settings-card">
        <div className="settings-card-heading">
          <span>OUTPUT &amp; CONTEXT</span>
          <h2>Control the answer without hardcoding a model</h2>
          <p>
            Response depth shapes the visible answer. Model reasoning is selected separately from
            the live provider catalog on each chat turn.
          </p>
        </div>
        <div className="agent-setting-columns">
          <fieldset>
            <legend>Response depth</legend>
            {DEPTH_CHOICES.map((choice) => (
              <label key={choice.id}>
                <input
                  type="radio"
                  name="response-depth"
                  checked={responseDepth === choice.id}
                  onChange={() => setResponseDepth(choice.id)}
                  disabled={busy}
                />
                <span>
                  <strong>{choice.label}</strong>
                  <small>{choice.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Local context scope</legend>
            {CONTEXT_CHOICES.map((choice) => (
              <label key={choice.id}>
                <input
                  type="radio"
                  name="context-scope"
                  checked={contextScope === choice.id}
                  onChange={() => setContextScope(choice.id)}
                  disabled={busy}
                />
                <span>
                  <strong>{choice.label}</strong>
                  <small>{choice.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      </article>

      <article className="settings-card">
        <div className="settings-card-heading">
          <span>PROJECT INSTRUCTIONS</span>
          <h2>Add a persistent project prompt</h2>
          <p>
            Use this for research conventions, decision criteria, and response preferences. It is
            versioned locally and cannot override GOSU's safety boundary.
          </p>
        </div>
        <label className="agent-instructions-field">
          Custom instructions
          <textarea
            value={customInstructions}
            onChange={(event) => setCustomInstructions(event.target.value)}
            maxLength={PROJECT_CHAT_MAX_CUSTOM_INSTRUCTIONS_LENGTH}
            rows={8}
            placeholder="Example: Separate verified evidence from hypotheses. Prefer falsifiable next experiments and call out metric leakage risks."
            disabled={busy}
          />
          <span>
            {customInstructions.length.toLocaleString()} /{' '}
            {PROJECT_CHAT_MAX_CUSTOM_INSTRUCTIONS_LENGTH.toLocaleString()}
          </span>
        </label>
        <div className="agent-safety-boundary">
          <strong>Fixed capability boundary</strong>
          <span>
            Project-bound read tools only · no shell · no arbitrary files · no network · no
            subagents
          </span>
          <small>
            Board and Objective can be read live. Board changes remain proposals and require Apply.
            Reviewer actions are discarded by the Main process even if a model returns one.
          </small>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={busy || !hasChanges}>
            {busy ? 'Saving…' : 'Save project agent profile'}
          </button>
          <span className="agent-profile-version">Profile version {profile.version}</span>
        </div>
      </article>
    </form>
  );
}
