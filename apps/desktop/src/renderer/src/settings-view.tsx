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
  { id: 'compact', label: 'Compact', description: 'Fit more on screen', sample: 'Aa' },
  { id: 'default', label: 'Default', description: 'Readable by default', sample: 'Aa' },
  { id: 'large', label: 'Large', description: 'Larger research text', sample: 'Aa' },
  { id: 'extra-large', label: 'Extra large', description: 'Maximum readability', sample: 'Aa' },
];

export function SettingsView({
  preferences,
  onChange,
}: {
  preferences: UserPreferences;
  onChange: (preferences: UserPreferences) => void;
}) {
  return (
    <section className="settings-layout" aria-label="Application settings">
      <article className="settings-card">
        <div className="settings-card-heading">
          <span>APPEARANCE</span>
          <h2>Choose how GOSU looks</h2>
          <p>System follows the light or dark appearance selected in macOS.</p>
        </div>
        <div className="preference-options appearance-options" role="group" aria-label="Appearance">
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
          <span>TEXT SIZE</span>
          <h2>Make research text comfortable</h2>
          <p>The change applies immediately across chat, Board, forms, notes, and navigation.</p>
        </div>
        <div className="preference-options text-size-options" role="group" aria-label="Text size">
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
            GOSU keeps this preference on this Mac. It is not sent to Hosted Sync or included in a
            project repository.
          </p>
        </div>
      </article>
    </section>
  );
}
