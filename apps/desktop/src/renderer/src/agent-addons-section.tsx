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
        <h2>Connect an existing local agent</h2>
        <p>
          Codex stays GOSU&apos;s default provider. BYO Hermes uses the Hermes installation and
          account already configured on this Mac; GOSU neither copies nor synchronizes its
          credentials.
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
                    <strong>Connect existing Hermes (BYO)</strong>
                    <small>
                      Use its configured model in Project Chat with GOSU&apos;s no-tool boundary
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
                          ? 'BYO Hermes connection unavailable'
                          : 'Detection unavailable'
                        : status?.connected
                          ? 'BYO Hermes ready for Project Chat'
                          : status?.state === 'detected_local_cli'
                            ? 'Local CLI detected — not connected'
                            : status?.state === 'not_detected'
                              ? 'Local CLI not detected'
                              : 'Detection not run'}
                </strong>
                <span>
                  {status?.connected
                    ? `${status.version ?? 'Compatible local version'} · credentials stay with Hermes and are validated by Hermes when the first turn runs.`
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
        <strong>BYO boundary</strong>
        <span>Hermes is optional, local, and never an automatic fallback</span>
        <small>
          GOSU launches Hermes only after an explicit Project Chat selection. The initial adapter
          disables Hermes tools, rules, memory, skills, and MCP access. It can analyze the supplied
          project snapshot and reply, but cannot mutate Board or Research Notes, use attachments,
          browse, or run local/SSH commands. OpenClaw remains detection-only.
        </small>
      </div>
    </article>
  );
}
