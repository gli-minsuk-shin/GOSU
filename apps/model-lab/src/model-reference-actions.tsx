import { uiText } from '@gosu/ui/language';
import './model-reference-actions.css';

export function ModelReferenceActions({
  name,
  disabled = false,
  onLocal,
}: {
  name: string;
  disabled?: boolean;
  onLocal: () => void;
}) {
  return (
    <span className="model-reference-actions" aria-label={uiText('Discuss this model')}>
      <button
        type="button"
        disabled={disabled}
        onClick={onLocal}
        title={`${name} · ${uiText('Ask in Model Assistant')}`}
        aria-label={`${name} · ${uiText('Ask in Model Assistant')}`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" />
          <circle cx="8" cy="10" r=".6" />
          <circle cx="12" cy="10" r=".6" />
          <circle cx="16" cy="10" r=".6" />
        </svg>
        <span>{uiText('AI conversation')}</span>
      </button>
    </span>
  );
}
