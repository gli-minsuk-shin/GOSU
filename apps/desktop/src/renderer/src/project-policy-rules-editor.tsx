import { useEffect, useId, useState } from 'react';

import {
  PROJECT_CHAT_MAX_POLICY_RULE_LENGTH,
  PROJECT_CHAT_MAX_POLICY_RULES,
  ProjectChatPolicyRulesSchema,
} from '../../shared/project-chat-contracts';

export function projectPolicyRulesValidationMessage(rules: readonly string[]) {
  const parsed = ProjectChatPolicyRulesSchema.safeParse(rules);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  return issue?.message ?? 'Review the project rule and try again.';
}

export function ProjectPolicyRulesEditor({
  projectName,
  rules,
  profileVersion,
  disabled = false,
  onSave,
  onClose,
}: {
  projectName: string;
  rules: readonly string[];
  profileVersion: number;
  disabled?: boolean;
  onSave: (rules: readonly string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const prefix = useId();
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [removingIndex, setRemovingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAdding(false);
    setAddText('');
    setEditingIndex(null);
    setEditText('');
    setRemovingIndex(null);
    setSaving(false);
  }, [profileVersion]);

  const controlsDisabled = disabled || saving;
  const persist = async (nextRules: readonly string[], successMessage: string) => {
    const parsed = ProjectChatPolicyRulesSchema.safeParse(nextRules);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Review the project rule and try again.');
      return false;
    }
    setSaving(true);
    setError(null);
    setStatus('Saving project rules…');
    try {
      const saved = await onSave(parsed.data);
      if (!saved) {
        setError('Project rules could not be saved. The latest project profile was reloaded.');
        setStatus(null);
        return false;
      }
      setStatus(successMessage);
      return true;
    } catch {
      setError('Project rules could not be saved. Nothing was changed.');
      setStatus(null);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="project-policy-rules-editor" aria-labelledby={`${prefix}-heading`}>
      <header>
        <div>
          <span>PROJECT-WIDE POLICY</span>
          <h2 id={`${prefix}-heading`}>Rules for {projectName}</h2>
          <p>
            Applied to every existing and new chat session in this project. Rules cannot grant
            tools, permissions, or access to another project.
          </p>
        </div>
        <div className="project-policy-rules-header-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={controlsDisabled || adding || rules.length >= PROJECT_CHAT_MAX_POLICY_RULES}
            onClick={() => {
              setAdding(true);
              setAddText('');
              setEditingIndex(null);
              setRemovingIndex(null);
              setError(null);
            }}
          >
            Add rule
          </button>
          <button type="button" className="ghost-button" disabled={saving} onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      {rules.length === 0 && !adding ? (
        <p className="project-policy-rules-empty">
          No project rules yet. Add one concise rule for conventions the assistant must keep across
          sessions.
        </p>
      ) : (
        <ol className="project-policy-rules-list">
          {rules.map((rule, index) => (
            <li key={`${index}:${rule}`}>
              <span className="project-policy-rule-number" aria-hidden="true">
                {index + 1}
              </span>
              {editingIndex === index ? (
                <form
                  className="project-policy-rule-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = rules.map((candidate, candidateIndex) =>
                      candidateIndex === index ? editText : candidate,
                    );
                    void persist(next, `Updated project rule ${index + 1}.`).then((saved) => {
                      if (saved) {
                        setEditingIndex(null);
                        setEditText('');
                      }
                    });
                  }}
                >
                  <label htmlFor={`${prefix}-edit-${index}`}>Edit rule {index + 1}</label>
                  <textarea
                    id={`${prefix}-edit-${index}`}
                    value={editText}
                    maxLength={PROJECT_CHAT_MAX_POLICY_RULE_LENGTH}
                    rows={3}
                    autoFocus
                    disabled={controlsDisabled}
                    onChange={(event) => setEditText(event.target.value)}
                  />
                  <small>
                    {editText.length.toLocaleString()} /{' '}
                    {PROJECT_CHAT_MAX_POLICY_RULE_LENGTH.toLocaleString()}
                  </small>
                  <div>
                    <button type="submit" className="primary-button" disabled={controlsDisabled}>
                      {saving ? 'Saving…' : 'Save rule'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={saving}
                      onClick={() => {
                        setEditingIndex(null);
                        setEditText('');
                        setError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p>{rule}</p>
                  <div className="project-policy-rule-actions">
                    {removingIndex === index ? (
                      <>
                        <span>Remove this rule?</span>
                        <button
                          type="button"
                          className="danger-button"
                          disabled={controlsDisabled}
                          onClick={() => {
                            const next = rules.filter(
                              (_candidate, candidateIndex) => candidateIndex !== index,
                            );
                            void persist(next, `Removed project rule ${index + 1}.`).then(
                              (saved) => {
                                if (saved) setRemovingIndex(null);
                              },
                            );
                          }}
                        >
                          {saving ? 'Removing…' : 'Remove'}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={saving}
                          onClick={() => setRemovingIndex(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={controlsDisabled}
                          onClick={() => {
                            setEditingIndex(index);
                            setEditText(rule);
                            setAdding(false);
                            setRemovingIndex(null);
                            setError(null);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ghost-button danger"
                          disabled={controlsDisabled}
                          onClick={() => {
                            setRemovingIndex(index);
                            setEditingIndex(null);
                            setAdding(false);
                            setError(null);
                          }}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {adding && (
        <form
          className="project-policy-rule-form project-policy-rule-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            void persist([...rules, addText], 'Added a project-wide rule.').then((saved) => {
              if (saved) {
                setAdding(false);
                setAddText('');
              }
            });
          }}
        >
          <label htmlFor={`${prefix}-add`}>New project rule</label>
          <textarea
            id={`${prefix}-add`}
            value={addText}
            maxLength={PROJECT_CHAT_MAX_POLICY_RULE_LENGTH}
            rows={3}
            autoFocus
            disabled={controlsDisabled}
            placeholder="Example: Always separate verified evidence from hypotheses and state uncertainty explicitly."
            onChange={(event) => setAddText(event.target.value)}
          />
          <small>
            {addText.length.toLocaleString()} /{' '}
            {PROJECT_CHAT_MAX_POLICY_RULE_LENGTH.toLocaleString()}
          </small>
          <div>
            <button type="submit" className="primary-button" disabled={controlsDisabled}>
              {saving ? 'Saving…' : 'Add rule'}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={saving}
              onClick={() => {
                setAdding(false);
                setAddText('');
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <footer>
        <span>
          {rules.length} / {PROJECT_CHAT_MAX_POLICY_RULES} rules · project profile v{profileVersion}
        </span>
        {error && <strong role="alert">{error}</strong>}
        {status && (
          <span role="status" aria-live="polite">
            {status}
          </span>
        )}
      </footer>
    </section>
  );
}
