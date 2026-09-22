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
  it('names the plan limits and the project archive in Korean', () => {
    setUiLanguage('ko');
    expect(uiText('{name} weekly', { name: 'Codex' })).toBe('Codex 주간');
    expect(uiText('{name} {hours}h', { name: 'Claude', hours: 5 })).toBe('Claude 5시간');
    expect(uiText('{remaining} left ({used} used)', { remaining: '87%', used: '13%' })).toBe(
      '87% 남음(13% 사용)',
    );
    expect(uiText('in {days}d {hours}h', { days: 5, hours: 6 })).toBe('5일 6시간 뒤');
    expect(uiText('Refresh every')).toBe('갱신 주기');
    // The user looked for "아카이브"; the old label "보관" hid the feature in plain sight.
    expect(uiText('Move to archive')).toBe('아카이브로 이동');
    expect(uiText('Archived')).toBe('아카이브');
    expect(uiText('Restored {name} to the active projects.', { name: 'Alpha' })).toBe(
      'Alpha을(를) 활성 프로젝트로 복원했습니다.',
    );
  });
  it('names the usage distribution and the feature table in Korean', () => {
    setUiLanguage('ko');
    expect(uiText('Usage distribution')).toBe('사용 분포');
    expect(uiText('BY MODEL AND FEATURE')).toBe('모델별 · 기능별');
    expect(uiText('Features')).toBe('기능');
    expect(uiText('Usage by feature')).toBe('기능별 사용량');
    expect(uiText('No model breakdown')).toBe('모델별 내역 없음');
    expect(uiText('{tokens} tokens', { tokens: '1,204' })).toBe('토큰 1,204개');
    expect(uiText('API-equivalent {cost}', { cost: '$3.41' })).toBe('API 환산 $3.41');
    expect(uiText('{count} more', { count: 4 })).toBe('외 4개');
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

describe('Model Lab product naming', () => {
  it('calls the Model Lab chat "Model Assistant" everywhere a user can read it', () => {
    const visible = Object.values(modelLabMessages).flatMap(({ en, ko }) => [en, ko]);

    // Renamed on 2026-09-22 at the user's request (the old name reads like another company's
    // product). Identifiers, routes and storage keys keep their names; visible text does not.
    expect(visible.filter((text) => /copilot/iu.test(text))).toEqual([]);
    expect(visible).toContain('Model Assistant');
    expect(modelLabMessages['Model Assistant']?.ko).toBe('Model Assistant');
  });
});
