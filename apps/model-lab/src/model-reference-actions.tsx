import { uiText } from '@gosu/ui/language';
import './model-reference-actions.css';

export function ModelReferenceActions({
  name,
  hosted,
  disabled = false,
  onProject,
  onLocal,
}: {
  name: string;
  hosted: boolean;
  disabled?: boolean;
  onProject: () => void;
  onLocal: () => void;
}) {
  return (
    <span className="model-reference-actions" aria-label={uiText('Discuss this model')}>
      {hosted && (
        <button
          type="button"
          disabled={disabled}
          onClick={onProject}
          title={`${name} · ${uiText('Ask in Project Chat')}`}
          aria-label={`${name} · ${uiText('Ask in Project Chat')}`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4H5a2 2 0 0 0-2 2v12l4-3h8a2 2 0 0 0 2-2v-2M15 3h6v6M21 3l-9 9" />
          </svg>
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={onLocal}
        title={`${name} · ${uiText('Ask in Model Lab')}`}
        aria-label={`${name} · ${uiText('Ask in Model Lab')}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" />
          <circle cx="8" cy="10" r=".6" />
          <circle cx="12" cy="10" r=".6" />
          <circle cx="16" cy="10" r=".6" />
        </svg>
      </button>
    </span>
  );
}
