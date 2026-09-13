import { expect, it } from 'vitest';
import {
  LiveSettingsSchema,
  defaultLiveSettings,
  defaultAssistantPreferences,
} from '../src/live-settings.js';
it('defaults public auto-paper summaries on but keeps every private capability off, preserving legacy settings', () => {
  const preferences = defaultAssistantPreferences();
  expect(preferences.autoPaperSummary).toBe(true);
  expect(preferences.mailRead).toBe(false);
  expect(preferences.mailAi).toBe(false);
  expect(preferences.mailBodyPreview).toBe(true);
  expect(preferences.calendarRead).toBe(false);
  expect(preferences.calendarIds).toEqual([]);
  expect(preferences.confirmationPolicy).toBe('always');
  expect(preferences.mailOpenConfirmation).toBe('always');
  expect(LiveSettingsSchema.parse(defaultLiveSettings()).assistant).toBeUndefined();
  expect(
    LiveSettingsSchema.parse({ ...defaultLiveSettings(), assistant: preferences }).assistant,
  ).toEqual(preferences);
  expect(
    LiveSettingsSchema.parse({
      ...defaultLiveSettings(),
      assistant: { ...preferences, confirmationPolicy: undefined },
    }).assistant?.confirmationPolicy,
  ).toBe('always');
  expect(
    LiveSettingsSchema.safeParse({
      ...defaultLiveSettings(),
      assistant: { ...preferences, apiKey: 'secret' },
    }).success,
  ).toBe(false);
});
it('validates optional live settings without granting mail or guessing user location', () => {
  expect(defaultLiveSettings().mail).toBeNull();
  expect(defaultLiveSettings().weather).toBeNull();
  expect(LiveSettingsSchema.safeParse(defaultLiveSettings()).success).toBe(true);
  expect(
    LiveSettingsSchema.safeParse({
      ...defaultLiveSettings(),
      papers: { enabled: true, days: 0, limit: 1000, author: '' },
    }).success,
  ).toBe(false);
  expect(
    LiveSettingsSchema.safeParse({
      ...defaultLiveSettings(),
      weather: { id: 1, name: 'city', latitude: 100, longitude: 0, country: '', timeZone: 'UTC' },
    }).success,
  ).toBe(false);
});
