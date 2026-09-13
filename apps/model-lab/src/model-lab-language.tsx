import { useEffect, useRef, useState } from 'react';
import {
  getUiLanguage,
  setUiLanguage,
  useUiLanguage,
  useUiText,
  uiText,
  type UiLanguage,
} from '@gosu/ui/language';
import { modelLabFetch } from './model-lab-environment';

const endpoint = '/api/application-language';

/** These patterns are emitted by the deterministic audit, never model-authored explanations. */
export function modelLabReviewSummary(source: string) {
  if (getUiLanguage() === 'en') return source;
  const patterns: readonly [RegExp, string][] = [
    [
      /^(\d+) tensor interfaces are dimensionally consistent\.$/u,
      '{count} tensor interfaces are dimensionally consistent.',
    ],
    [/^(\d+) tensor interface mismatches? found\.$/u, '{count} tensor interface mismatches found.'],
    [
      /^(\d+) transform-to-equation mismatches? found\.$/u,
      '{count} transform-to-equation mismatches found.',
    ],
    [
      /^All (\d+) module anchors resolve to a verified source artifact\.$/u,
      'All {count} module anchors resolve to a verified source artifact.',
    ],
    [
      /^(\d+) module anchors do not resolve to a verified source artifact\.$/u,
      '{count} module anchors do not resolve to a verified source artifact.',
    ],
  ];
  for (const [pattern, template] of patterns) {
    const match = pattern.exec(source);
    if (match?.[1]) return uiText(template, { count: match[1] });
  }
  const formulas =
    /^All (\d+) module equations across (\d+) model graphs? are consistent with recognized operations in their text\.$/u.exec(
      source,
    );
  if (formulas)
    return uiText(
      'All {count} module equations across {models} model graphs are consistent with recognized operations in their text.',
      { count: formulas[1]!, models: formulas[2]! },
    );
  const backward =
    /^(\d+) backward paths? and (\d+) trainable parameter tensors? need attention\.$/u.exec(source);
  if (backward)
    return uiText(
      '{count} backward paths and {parameters} trainable parameter tensors need attention.',
      { count: backward[1]!, parameters: backward[2]! },
    );
  return uiText(source);
}

function languageResponse(value: unknown): UiLanguage {
  if (
    !value ||
    typeof value !== 'object' ||
    !('language' in value) ||
    (value.language !== 'ko' && value.language !== 'en')
  )
    throw new Error('invalid_language_response');
  return value.language;
}

/** One preference for the desktop and standalone UI, never a workspace/model mutation. */
export function useModelLabLanguagePreference() {
  const language = useUiLanguage();
  const [status, setStatus] = useState<'idle' | 'saving' | 'load-failed' | 'save-failed'>('idle');
  const generation = useRef(0);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let fetching = false;
    const refresh = async () => {
      if (fetching || saving.current || document.visibilityState === 'hidden') return;
      fetching = true;
      const atStart = generation.current;
      try {
        const response = await modelLabFetch(endpoint, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('language_load_failed');
        const next = languageResponse(await response.json());
        if (mounted.current && atStart === generation.current) {
          setUiLanguage(next);
          setStatus((current) => (current === 'load-failed' ? 'idle' : current));
        }
      } catch {
        if (mounted.current && atStart === generation.current)
          setStatus((current) => (current === 'idle' ? 'load-failed' : current));
      } finally {
        fetching = false;
      }
    };
    const onVisible = () => {
      void refresh();
    };
    void refresh();
    const timer = setInterval(onVisible, 15_000);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      generation.current++;
      clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = async (next: UiLanguage) => {
    if (saving.current || next === getUiLanguage()) return;
    saving.current = true;
    const request = ++generation.current;
    setStatus('saving');
    try {
      const response = await modelLabFetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('language_save_failed');
      const stored = languageResponse(await response.json());
      if (mounted.current && request === generation.current) {
        setUiLanguage(stored);
        setStatus('idle');
      }
    } catch {
      if (mounted.current && request === generation.current) setStatus('save-failed');
    } finally {
      saving.current = false;
    }
  };
  return { language, status, changeLanguage };
}

export function ModelLabLanguageSettings({
  preference,
}: {
  preference: ReturnType<typeof useModelLabLanguagePreference>;
}) {
  const t = useUiText();
  return (
    <details className="model-language-settings">
      <summary>{t('Application language')}</summary>
      <label>
        {t('Application language')}
        <select
          aria-label={t('Application language')}
          value={preference.language}
          disabled={preference.status === 'saving'}
          onChange={(event) => {
            void preference.changeLanguage(event.target.value as UiLanguage);
          }}
        >
          <option value="ko">한국어</option>
          <option value="en">English</option>
        </select>
      </label>
      <small>
        {t(
          'Language is shared with GOSU. Model source, equations and existing conversations are preserved.',
        )}
      </small>
      {preference.status !== 'idle' && (
        <p role={preference.status === 'saving' ? 'status' : 'alert'}>
          {t(
            preference.status === 'saving'
              ? 'Saving language…'
              : preference.status === 'save-failed'
                ? 'Language could not be saved. Try again.'
                : 'Language could not be loaded.',
          )}
        </p>
      )}
    </details>
  );
}
