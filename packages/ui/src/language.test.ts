import { afterEach, describe, expect, it } from 'vitest';
import { getUiLanguage, setUiLanguage, uiLocale, uiText } from './language.js';
import { commonMessages } from './common-messages.js';
import { desktopMessages } from './desktop-messages.js';
import { shellMessages } from './shell-messages.js';
import { modelLabMessages } from './model-lab-messages.js';
import { backendUiMessages } from './backend-ui-messages.js';
import { desktopHelpMessages } from './desktop-help-messages.js';
import { toolActivityMessages } from './tool-activity-messages.js';
import { notificationMessages } from './notification-messages.js';

afterEach(() => setUiLanguage('en'));
describe('shared application language', () => {
  it('labels all four requested font presets in Korean', () => {
    setUiLanguage('ko');
    for (const pixels of [10, 12, 14, 16])
      expect(uiText(`${pixels} px base`)).toBe(`기본 ${pixels}px`);
  });
  it('switches known interface copy without changing unknown source text or technical identifiers', () => {
    expect(uiText('Project chat')).toBe('Project chat');
    setUiLanguage('ko');
    expect(uiText('Project chat')).toBe('프로젝트 채팅');
    expect(uiText('Settings')).toBe('설정');
    expect(uiText('Model Lab')).toBe('Model Lab');
    expect(uiText('My custom model: H[:, d:] = 7 * tanh(H[:, d:] / 7)')).toBe(
      'My custom model: H[:, d:] = 7 * tanh(H[:, d:] / 7)',
    );
    setUiLanguage('en');
    expect(uiText('Project chat')).toBe('Project chat');
  });
  it('keeps dynamic user values literal and does not recursively substitute placeholders', () => {
    setUiLanguage('ko');
    expect(uiText('Actions for {name}', { name: 'Settings {name}' })).toBe('Settings {name} 작업');
    expect(uiText('Actions for {name}')).toBe('{name} 작업');
    expect(uiText('  Settings ')).toBe('  설정 ');
  });
  it('validates the closed enum and shares the formatting locale', () => {
    expect(uiLocale()).toBe('en-US');
    setUiLanguage('ko');
    expect(uiLocale()).toBe('ko-KR');
    expect(() => setUiLanguage('fr' as 'en')).toThrow('invalid_ui_language');
    expect(getUiLanguage()).toBe('ko');
  });
  it('provides both languages and keeps named interpolation parameters identical', () => {
    const placeholders = (value: string) =>
      [...new Set(value.match(/\{[A-Za-z][A-Za-z0-9_]*\}/gu) ?? [])].sort();
    for (const catalog of [
      notificationMessages,
      toolActivityMessages,
      desktopHelpMessages,
      commonMessages,
      desktopMessages,
      shellMessages,
      modelLabMessages,
      backendUiMessages,
    ]) {
      for (const [source, value] of Object.entries(catalog)) {
        expect(value.en.trim(), source).not.toBe('');
        expect(value.ko.trim(), source).not.toBe('');
        expect(placeholders(value.ko), source).toEqual(placeholders(value.en));
      }
    }
  });
});
