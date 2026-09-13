import { useMemo, useSyncExternalStore } from 'react';

import { commonMessages } from './common-messages.js';
import { desktopMessages } from './desktop-messages.js';
import { modelLabMessages } from './model-lab-messages.js';
import { shellMessages } from './shell-messages.js';
import { backendUiMessages } from './backend-ui-messages.js';
import { desktopHelpMessages } from './desktop-help-messages.js';
import { toolActivityMessages } from './tool-activity-messages.js';
import { notificationMessages } from './notification-messages.js';

export type UiLanguage = 'en' | 'ko';
export type UiMessages = Readonly<Record<string, Readonly<Record<UiLanguage, string>>>>;
export type UiTextParameters = Readonly<Record<string, string | number>>;

const messages: UiMessages = {
  ...notificationMessages,
  ...toolActivityMessages,
  ...desktopMessages,
  ...desktopHelpMessages,
  ...modelLabMessages,
  ...Object.fromEntries(
    Object.values(backendUiMessages).flatMap((entry) => [
      [entry.en, entry],
      [entry.ko, entry],
    ]),
  ),
  ...shellMessages,
  ...commonMessages,
};
let language: UiLanguage = 'en';
const listeners = new Set<() => void>();

export function getUiLanguage(): UiLanguage {
  return language;
}

export function setUiLanguage(next: UiLanguage): void {
  if (next !== 'en' && next !== 'ko') throw new Error('invalid_ui_language');
  if (language === next) return;
  language = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUiLanguage(): UiLanguage {
  return useSyncExternalStore(subscribe, getUiLanguage, getUiLanguage);
}

/** Only call with application-authored UI copy, never arbitrary document/user/model content. */
export function uiText(
  source: string,
  parameters: UiTextParameters = {},
  selectedLanguage: UiLanguage = getUiLanguage(),
): string {
  const exact = Object.prototype.hasOwnProperty.call(messages, source);
  const trimmed = source.trim();
  const translated = exact
    ? messages[source]![selectedLanguage]
    : Object.prototype.hasOwnProperty.call(messages, trimmed)
      ? `${source.match(/^\s*/u)?.[0] ?? ''}${messages[trimmed]![selectedLanguage]}${source.match(/\s*$/u)?.[0] ?? ''}`
      : source;
  return translated.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(parameters, key) ? String(parameters[key]) : match,
  );
}

export function useUiText() {
  const selectedLanguage = useUiLanguage();
  return useMemo(
    () => (source: string, parameters?: UiTextParameters) =>
      uiText(source, parameters, selectedLanguage),
    [selectedLanguage],
  );
}

export function uiLocale(selectedLanguage: UiLanguage = getUiLanguage()) {
  return selectedLanguage === 'ko' ? 'ko-KR' : 'en-US';
}

export function formatUiDateTime(
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(uiLocale(), options).format(new Date(value));
}
