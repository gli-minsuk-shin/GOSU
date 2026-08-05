import { useEffect, useState } from 'react';

import {
  PROJECT_CHAT_MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  type CodexCollaborationModeDescriptor,
  type LocalNotesVaultGrant,
  type ProjectChatContextScope,
  type ProjectChatPersonality,
  type ProjectChatProfile,
  type ProjectChatResponseVerbosity,
  type ProjectChatWebSearchMode,
  type UpdateProjectChatProfileInput,
} from '../../shared/project-chat-contracts';
import type { VaultSelection } from '../../shared/vault-contracts';
import type { ProjectRecord } from '../../shared/workspace-contracts';
import type { VaultRuntimeState } from './notes-view';

const VERBOSITY_CHOICES: ReadonlyArray<{
  id: ProjectChatResponseVerbosity;
  label: string;
  description: string;
}> = [
  { id: 'auto', label: 'Auto', description: 'Use the model default' },
  { id: 'low', label: 'Low', description: 'Compact visible answer' },
  { id: 'medium', label: 'Medium', description: 'Balanced visible answer' },
  { id: 'high', label: 'High', description: 'More complete visible answer' },
];

const PERSONALITY_CHOICES: ReadonlyArray<{
  id: ProjectChatPersonality;
  label: string;
  description: string;
}> = [
  { id: 'auto', label: 'Auto', description: 'Use the Codex/model default' },
  { id: 'friendly', label: 'Friendly', description: 'Warm, collaborative voice' },
  { id: 'pragmatic', label: 'Pragmatic', description: 'Direct, execution-focused voice' },
  { id: 'none', label: 'None', description: 'No personality override' },
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

const WEB_SEARCH_CHOICES: ReadonlyArray<{
  id: ProjectChatWebSearchMode;
  label: string;
  description: string;
}> = [
  {
    id: 'cached',
    label: 'Cached (recommended)',
    description: 'Search an OpenAI-maintained index without fetching arbitrary live pages',
  },
  {
    id: 'live',
    label: 'Live',
    description: 'Retrieve current web results when freshness matters',
  },
  {
    id: 'disabled',
    label: 'Disabled',
    description: 'Remove the Codex web search tool for this project',
  },
];

export function AgentSettingsSection({
  project,
  profile,
  loading,
  busy,
  collaborationModes = [],
  vault,
  vaultState,
  onSave,
}: {
  project: ProjectRecord | undefined;
  profile: ProjectChatProfile | undefined;
  loading: boolean;
  busy: boolean;
  collaborationModes: readonly CodexCollaborationModeDescriptor[];
  vault: VaultSelection | null;
  vaultState: VaultRuntimeState;
  onSave: (input: UpdateProjectChatProfileInput) => Promise<boolean>;
}) {
  const [collaborationModeId, setCollaborationModeId] = useState<string | null>(() =>
    profile?.harnessMode === 'reviewer' ? null : (profile?.collaborationModeId ?? null),
  );
  const [legacyReviewerCompatibility, setLegacyReviewerCompatibility] = useState(
    () => profile?.harnessMode === 'reviewer',
  );
  const [personality, setPersonality] = useState<ProjectChatPersonality>(
    () => profile?.personality ?? 'auto',
  );
  const [responseVerbosity, setResponseVerbosity] = useState<ProjectChatResponseVerbosity>(
    () => profile?.responseVerbosity ?? 'auto',
  );
  const [webSearchMode, setWebSearchMode] = useState<ProjectChatWebSearchMode>(
    () => profile?.webSearchMode ?? 'cached',
  );
  const [contextScope, setContextScope] = useState<ProjectChatContextScope>(
    () => profile?.contextScope ?? 'project',
  );
  const [customInstructions, setCustomInstructions] = useState(
    () => profile?.customInstructions ?? '',
  );
  const [localNotesVault, setLocalNotesVault] = useState<LocalNotesVaultGrant | null>(
    () => profile?.localNotesVault ?? null,
  );

  useEffect(() => {
    const preserveLegacyReviewer = profile?.harnessMode === 'reviewer';
    setLegacyReviewerCompatibility(preserveLegacyReviewer);
    setCollaborationModeId(preserveLegacyReviewer ? null : (profile?.collaborationModeId ?? null));
    setPersonality(profile?.personality ?? 'auto');
    setResponseVerbosity(profile?.responseVerbosity ?? 'auto');
    setWebSearchMode(profile?.webSearchMode ?? 'cached');
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
    (!legacyReviewerCompatibility && collaborationModeId !== profile.collaborationModeId) ||
    personality !== profile.personality ||
    responseVerbosity !== profile.responseVerbosity ||
    webSearchMode !== profile.webSearchMode ||
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
          harnessMode: legacyReviewerCompatibility
            ? 'reviewer'
            : collaborationModeId === 'plan'
              ? 'planner'
              : 'context',
          responseDepth:
            responseVerbosity === 'low'
              ? 'concise'
              : responseVerbosity === 'high'
                ? 'deep'
                : 'standard',
          collaborationModeId: legacyReviewerCompatibility
            ? profile.collaborationModeId
            : collaborationModeId,
          personality,
          responseVerbosity,
          webSearchMode,
          contextScope,
          localNotesVault,
          customInstructions,
        });
      }}
    >
      <article className="settings-card">
        <div className="settings-card-heading">
          <span>NATIVE CODEX HARNESS · {project.name}</span>
          <h2>Choose a Codex collaboration mode</h2>
          <p>
            GOSU discovers these modes from the pinned local Codex App Server. Modes supported by
            the bundled Codex runtime appear here automatically.
          </p>
        </div>
        <label className="agent-instructions-field">
          Collaboration mode
          <select
            value={collaborationModeId ?? ''}
            onChange={(event) => {
              setLegacyReviewerCompatibility(false);
              setCollaborationModeId(event.target.value || null);
            }}
            disabled={busy}
          >
            <option value="">
              {legacyReviewerCompatibility
                ? 'Legacy Reviewer · choose a native mode to leave'
                : 'Auto · Codex default'}
            </option>
            {collaborationModeId !== null &&
              !collaborationModes.some((mode) => mode.id === collaborationModeId) && (
                <option value={collaborationModeId} disabled>
                  Unavailable mode · choose again
                </option>
              )}
            {collaborationModes.map((mode) => (
              <option value={mode.id} key={mode.id}>
                {mode.displayName}
                {mode.recommendedReasoningOptionId
                  ? ` · ${mode.recommendedReasoningOptionId} reasoning`
                  : ''}
              </option>
            ))}
          </select>
          <span>
            The mode selects Codex's own agent loop and instructions. It never expands GOSU's
            project capability boundary.
          </span>
        </label>
      </article>

      <article className="settings-card">
        <div className="settings-card-heading">
          <span>WEB SEARCH</span>
          <h2>Choose web freshness per project</h2>
          <p>
            Cached search is the safer default. Live search is useful for current facts, but every
            result remains untrusted model input.
          </p>
        </div>
        <div className="agent-setting-columns">
          <fieldset>
            <legend>Codex web search mode</legend>
            {WEB_SEARCH_CHOICES.map((choice) => (
              <label key={choice.id}>
                <input
                  type="radio"
                  name="web-search-mode"
                  checked={webSearchMode === choice.id}
                  onChange={() => setWebSearchMode(choice.id)}
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
        <div className="agent-notes-disclosure">
          <strong>Capability boundary</strong>
          <span>
            This controls only Codex&apos;s first-party web search tool. It does not enable shell
            networking, the browser, MCP servers, plugins, or direct page control.
          </span>
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
            Personality and answer verbosity use native Codex turn/thread settings. Model reasoning
            remains a separate live-catalog choice on each turn.
          </p>
        </div>
        <div className="agent-setting-columns">
          <fieldset>
            <legend>Answer verbosity</legend>
            {VERBOSITY_CHOICES.map((choice) => (
              <label key={choice.id}>
                <input
                  type="radio"
                  name="response-verbosity"
                  checked={responseVerbosity === choice.id}
                  onChange={() => setResponseVerbosity(choice.id)}
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
            <legend>Personality</legend>
            {PERSONALITY_CHOICES.map((choice) => (
              <label key={choice.id}>
                <input
                  type="radio"
                  name="personality"
                  checked={personality === choice.id}
                  onChange={() => setPersonality(choice.id)}
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
            Codex sandbox: project-bound reads · no direct shell, filesystem, raw network, browser,
            MCP, or subagents
          </span>
          <small>
            Board and Objective can be read live. Board changes remain proposals and require Apply.
            A separate Main-process SSH broker can run bounded Git inspection and, in an explicitly
            granted Workspace mode, approved direct-argv tests/builds or a foreground Python
            experiment entrypoint that may execute project code. Every command requires a fresh
            Allow once decision; experiments are limited to 120 seconds. Raw shells, inline Python,
            TTY, transfer, unattended execution, broader capabilities, and access to another
            project's data remain unavailable.
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
