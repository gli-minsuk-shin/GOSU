import { useEffect, useState } from 'react';
import { setUiLanguage, useUiLanguage, useUiText, type UiLanguage } from '@gosu/ui/language';

export const UI_LANGUAGE_CACHE_KEY = 'gosu:application-language:v1';
let languageRevision = 0;

export function applyApplicationUiLanguage(language: UiLanguage) {
  languageRevision += 1;
  setUiLanguage(language);
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  try {
    window.localStorage.setItem(UI_LANGUAGE_CACHE_KEY, language);
  } catch {
    /* Main owns persistence. */
  }
}

export function loadCachedApplicationUiLanguage() {
  try {
    const language = window.localStorage.getItem(UI_LANGUAGE_CACHE_KEY);
    if (language === 'ko' || language === 'en') applyApplicationUiLanguage(language);
  } catch {
    /* An unavailable cache must not block startup. */
  }
}

/** Shares one authoritative Main preference with Model Lab without remounting any workspace. */
export function useApplicationLanguageSync() {
  useEffect(() => {
    const api = window.gosu?.applicationLanguage;
    if (!api) return;
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (disposed || pending || document.visibilityState === 'hidden') return;
      pending = true;
      const revision = languageRevision;
      try {
        const result = await api.get();
        if (!disposed && revision === languageRevision) applyApplicationUiLanguage(result.language);
      } catch {
        /* Keep the last confirmed UI language until a successful refresh. */
      } finally {
        pending = false;
      }
    };
    void refresh();
    const onVisible = () => {
      void refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(onVisible, 5000);
    const unsubscribe = api.onChanged?.((result) => {
      if (!disposed) applyApplicationUiLanguage(result.language);
    });
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe?.();
    };
  }, []);
}

export function ApplicationLanguageSettings() {
  const t = useUiText();
  const language = useUiLanguage();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);
  const choose = async (next: UiLanguage) => {
    if (pending) return;
    setPending(true);
    setStatus(null);
    try {
      const result = await window.gosu.applicationLanguage.set(next);
      applyApplicationUiLanguage(result.language);
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setPending(false);
    }
  };
  return (
    <article
      className="settings-card application-language-settings"
      aria-label={t('Application language')}
    >
      <div className="settings-card-heading">
        <span>{t('Language')}</span>
        <h2>{t('Application language')}</h2>
        <p>
          {t(
            'Choose the language for the interface and new AI explanations. Technical terms, code, equations, and original content stay unchanged.',
          )}
        </p>
      </div>
      <div
        className="preference-options language-preference-options"
        role="group"
        aria-label="한국어 / English"
      >
        {(['ko', 'en'] as const).map((next) => (
          <button
            key={next}
            type="button"
            className={language === next ? 'selected' : ''}
            aria-pressed={language === next}
            disabled={pending}
            onClick={() => void choose(next)}
          >
            <strong lang={next}>{next === 'ko' ? '한국어' : 'English'}</strong>
          </button>
        ))}
      </div>
      <p role={status === 'error' ? 'alert' : 'status'} aria-live="polite">
        {pending
          ? t('Saving language…')
          : status === 'saved'
            ? t('Language saved')
            : status === 'error'
              ? t('Language could not be saved. The previous setting is unchanged.')
              : null}
      </p>
    </article>
  );
}
