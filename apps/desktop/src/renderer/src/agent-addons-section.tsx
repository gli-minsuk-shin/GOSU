import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  AGENT_ADD_ON_DESCRIPTORS,
  type AgentAddOnId,
  type AgentAddOnPreference,
  type AgentAddOnStatus,
} from '../../shared/agent-addon-contracts';

type AgentAddOnPreferences = Readonly<Record<AgentAddOnId, AgentAddOnPreference>>;

export type HermesProjectChatConnectionUiState = Readonly<{
  phase: 'disabled' | 'checking' | 'ready' | 'unavailable';
  status: AgentAddOnStatus | null;
}>;

export function enabledAgentAddOnIds(preferences: AgentAddOnPreferences): readonly AgentAddOnId[] {
  return AGENT_ADD_ON_DESCRIPTORS.filter(
    (descriptor) => preferences[descriptor.id] !== 'disabled',
  ).map((descriptor) => descriptor.id);
}

export function AgentAddOnsSection({
  preferences,
  onChange,
  hermesConnection = { phase: 'disabled', status: null },
  onRefreshHermesConnection = async () => undefined,
}: {
  preferences: AgentAddOnPreferences;
  onChange: (preferences: AgentAddOnPreferences) => void;
  hermesConnection?: HermesProjectChatConnectionUiState;
  onRefreshHermesConnection?: () => Promise<unknown>;
}) {
  const [statuses, setStatuses] = useState<readonly AgentAddOnStatus[]>([]);
  const [checking, setChecking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const detectionGenerationRef = useRef(0);
  const enabledIds = useMemo(() => enabledAgentAddOnIds(preferences), [preferences]);
  const detectedIds = useMemo(
    () => enabledIds.filter((id) => preferences[id] === 'detect-local'),
    [enabledIds, preferences],
  );

  const detect = useCallback(async () => {
    const generation = ++detectionGenerationRef.current;
    if (detectedIds.length === 0) {
      setStatuses([]);
      setChecking(false);
      setUnavailable(false);
      return;
    }
    setChecking(true);
    setUnavailable(false);
    try {
      const detected = await window.gosu.agentAddOns.status(detectedIds);
      if (generation !== detectionGenerationRef.current) return;
      setStatuses(detected);
    } catch {
      if (generation !== detectionGenerationRef.current) return;
      setStatuses([]);
      setUnavailable(true);
    } finally {
      if (generation === detectionGenerationRef.current) setChecking(false);
    }
  }, [detectedIds]);

  useEffect(() => {
    void detect();
    return () => {
      detectionGenerationRef.current += 1;
    };
  }, [detect]);

  const refreshing = checking || hermesConnection.phase === 'checking';
  const checkAgain = () => {
    const requests: Promise<unknown>[] = [detect()];
    if (preferences.hermes === 'connect-local') {
      requests.push(onRefreshHermesConnection());
    }
    void Promise.allSettled(requests);
  };

  return (
    <article className="settings-card">
      <div className="settings-card-heading">
        <span>OPTIONAL AGENT ADD-ONS</span>
        <h2>Use a verified agent runtime</h2>
        <p>
          Codex stays GOSU&apos;s default provider. Release builds use the exact Hermes runtime
          shipped and signed with that GOSU version. Provider credentials remain in the isolated
          local profile and are never copied into the app bundle.
        </p>
      </div>
      <div className="agent-setting-columns">
        {AGENT_ADD_ON_DESCRIPTORS.map((descriptor) => {
          const preference = preferences[descriptor.id];
          const connectedHermes = descriptor.id === 'hermes' && preference === 'connect-local';
          const status = connectedHermes
            ? hermesConnection.status
            : statuses.find((candidate) => candidate.id === descriptor.id);
          const itemChecking = connectedHermes ? hermesConnection.phase === 'checking' : checking;
          const itemUnavailable = connectedHermes
            ? hermesConnection.phase === 'unavailable'
            : unavailable;
          return (
            <fieldset key={descriptor.id}>
              <legend>{descriptor.displayName}</legend>
              <label>
                <input
                  type="radio"
                  name={`${descriptor.id}-preference`}
                  checked={preference === 'disabled'}
                  onChange={() => onChange({ ...preferences, [descriptor.id]: 'disabled' })}
                />
                <span>
                  <strong>Disabled</strong>
                  <small>Do not check for or use this add-on</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name={`${descriptor.id}-preference`}
                  checked={preference === 'detect-local'}
                  onChange={() => onChange({ ...preferences, [descriptor.id]: 'detect-local' })}
                />
                <span>
                  <strong>Detect local installation</strong>
                  <small>Look for the {descriptor.executableName} CLI without running it</small>
                </span>
              </label>
              {descriptor.capabilities.projectChatProvider === 'available' && (
                <label>
                  <input
                    type="radio"
                    name={`${descriptor.id}-preference`}
                    checked={preference === 'connect-local'}
                    onChange={() => onChange({ ...preferences, [descriptor.id]: 'connect-local' })}
                  />
                  <span>
                    <strong>Use verified Hermes runtime</strong>
                    <small>
                      Prefer GOSU&apos;s pinned bundle; development builds may use a compatible
                      local installation
                    </small>
                  </span>
                </label>
              )}
              <div className="agent-notes-disclosure" aria-live="polite">
                <strong>
                  {preference === 'disabled'
                    ? 'Disabled'
                    : itemChecking
                      ? 'Checking this Mac…'
                      : itemUnavailable
                        ? connectedHermes
                          ? 'Hermes runtime unavailable'
                          : 'Detection unavailable'
                        : status?.connected
                          ? status.connectionMode === 'bundled-acp-agent'
                            ? 'Bundled Hermes ready for Project Chat'
                            : 'Custom local Hermes ready for Project Chat'
                          : status?.state === 'bundled_runtime'
                            ? 'Bundled Hermes runtime verified'
                            : status?.state === 'detected_local_cli'
                              ? 'Local CLI detected — not connected'
                              : status?.state === 'not_detected'
                                ? 'Local CLI not detected'
                                : 'Detection not run'}
                </strong>
                <span>
                  {status?.connected
                    ? `${status.version ?? 'Compatible pinned version'} · GOSU verified the runtime manifest and completed a sealed ACP session check before showing Connected; credentials remain local.`
                    : status?.state === 'bundled_runtime'
                      ? `${status.version ?? 'Pinned version'} · Signed GOSU application resource`
                      : status?.state === 'detected_local_cli'
                        ? 'The executable name was found, but its publisher, version, configuration, and identity have not been verified.'
                        : `GOSU has not connected ${descriptor.displayName} to Project Chat.`}
                </span>
              </div>
              <p>
                <a href={descriptor.officialSetupUrl} target="_blank" rel="noreferrer">
                  Open official setup guidance
                </a>{' '}
                · {descriptor.publisher}
              </p>
            </fieldset>
          );
        })}
      </div>
      {enabledIds.length > 0 && (
        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={refreshing}
            onClick={checkAgain}
          >
            {refreshing ? 'Checking…' : 'Check again'}
          </button>
        </div>
      )}
      <div className="agent-safety-boundary">
        <strong>Runtime boundary</strong>
        <span>Hermes is pinned, local, and never an automatic fallback</span>
        <small>
          Packaged GOSU launches only its hash-verified bundled Hermes ACP agent after an explicit
          selection; it never searches PATH or silently falls back to another version. Its only
          native tools are project-scoped file read and search. Codex can explicitly delegate a
          bounded task to a fresh Hermes primary ACP agent. File writes, terminal, processes, code
          execution, web, browser automation, native delegation, memory, skills, MCP, GOSU tools,
          and attachments are disabled. These read-only tools do not show mutation approval prompts.
          OpenClaw remains detection-only.
        </small>
      </div>
    </article>
  );
}
