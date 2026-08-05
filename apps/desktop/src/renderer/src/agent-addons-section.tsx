import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  AGENT_ADD_ON_DESCRIPTORS,
  type AgentAddOnId,
  type AgentAddOnPreference,
  type AgentAddOnStatus,
} from '../../shared/agent-addon-contracts';

type AgentAddOnPreferences = Readonly<Record<AgentAddOnId, AgentAddOnPreference>>;

export function enabledAgentAddOnIds(preferences: AgentAddOnPreferences): readonly AgentAddOnId[] {
  return AGENT_ADD_ON_DESCRIPTORS.filter(
    (descriptor) => preferences[descriptor.id] === 'detect-local',
  ).map((descriptor) => descriptor.id);
}

export function AgentAddOnsSection({
  preferences,
  onChange,
}: {
  preferences: AgentAddOnPreferences;
  onChange: (preferences: AgentAddOnPreferences) => void;
}) {
  const [statuses, setStatuses] = useState<readonly AgentAddOnStatus[]>([]);
  const [checking, setChecking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const enabledIds = useMemo(() => enabledAgentAddOnIds(preferences), [preferences]);

  const detect = useCallback(async () => {
    if (enabledIds.length === 0) {
      setStatuses([]);
      setUnavailable(false);
      return;
    }
    setChecking(true);
    setUnavailable(false);
    try {
      setStatuses(await window.gosu.agentAddOns.status(enabledIds));
    } catch {
      setStatuses([]);
      setUnavailable(true);
    } finally {
      setChecking(false);
    }
  }, [enabledIds]);

  useEffect(() => {
    if (enabledIds.length === 0) {
      setStatuses([]);
      setUnavailable(false);
      return;
    }
    void detect();
  }, [detect, enabledIds]);

  return (
    <article className="settings-card">
      <div className="settings-card-heading">
        <span>OPTIONAL AGENT ADD-ONS</span>
        <h2>Detect OpenClaw or Hermes without changing Project Chat</h2>
        <p>
          Codex stays GOSU&apos;s default provider. Detection only checks whether a local CLI name
          is present; it does not start, authenticate, connect, or grant project access to an
          add-on.
        </p>
      </div>
      <div className="agent-setting-columns">
        {AGENT_ADD_ON_DESCRIPTORS.map((descriptor) => {
          const preference = preferences[descriptor.id];
          const status = statuses.find((candidate) => candidate.id === descriptor.id);
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
              <div className="agent-notes-disclosure" aria-live="polite">
                <strong>
                  {preference === 'disabled'
                    ? 'Disabled'
                    : checking
                      ? 'Checking this Mac…'
                      : unavailable
                        ? 'Detection unavailable'
                        : status?.state === 'detected_local_cli'
                          ? 'Local CLI detected — not connected'
                          : status?.state === 'not_detected'
                            ? 'Local CLI not detected'
                            : 'Detection not run'}
                </strong>
                <span>
                  {status?.state === 'detected_local_cli'
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
          <button type="button" className="secondary-button" disabled={checking} onClick={detect}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
      )}
      <div className="agent-safety-boundary">
        <strong>Scaffold only</strong>
        <span>No installer, credentials, process launch, chat routing, or provider fallback</span>
        <small>
          A detected CLI is not a trusted or connected provider. Future integration must add a
          signed installer and a separately reviewed adapter before either add-on can receive a
          project prompt or capability.
        </small>
      </div>
    </article>
  );
}
