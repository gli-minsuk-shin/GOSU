import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { initialRealWorkspace } from './workspace-defaults';
import { defaultLiveSettings } from '@gosu/briefing-core';
import { SettingsProposalSchema, settingsProposalDraft } from './assistant-settings-proposal';
it('keeps common mail filters permanently visible instead of a disclosure', () => {
  const source = readFileSync(new URL('./mail-account-list.tsx', import.meta.url), 'utf8');
  expect(source).toContain(
    '<section className="mail-account-filters" aria-label="공통 조회 조건">',
  );
  expect(source).not.toContain('<details className="mail-account-filters">');
});
it('creates only an unsaved bounded draft preserving all other settings', () => {
  const routine = initialRealWorkspace('2026-09-11T00:00:00Z').routines[0]!;
  const before = structuredClone(routine);
  const draft = settingsProposalDraft(routine, { paperLimit: 20, paperDays: 10 });
  expect(draft.live?.papers.limit).toBe(20);
  expect(draft.live?.papers.days).toBe(10);
  expect(draft.live?.assistant).toEqual(routine.live?.assistant);
  expect(draft.schedule).toEqual(routine.schedule);
  expect(routine).toEqual(before);
});
it('applies requested mail values without replacing accounts or filters', () => {
  const base = initialRealWorkspace('2026-09-11T00:00:00Z').routines[0]!;
  const routine = {
    ...base,
    live: {
      ...defaultLiveSettings(),
      mail: {
        accountId: 'a',
        mailboxId: 'b',
        days: 3,
        limit: 50,
        sender: 'sender',
        subject: 'topic',
        unreadOnly: true,
        bodyPreview: false,
      },
    },
  };
  const draft = settingsProposalDraft(routine, { mailDays: 10, mailLimit: 100 });
  expect(draft.live?.mail).toEqual({ ...routine.live.mail, days: 10, limit: 100 });
  expect(routine.live.mail.limit).toBe(50);
});
it.each([
  {},
  { mailLimit: 101 },
  { mailDays: 0 },
  { mailRead: true },
  { calendarIds: ['x'] },
  { intervalHours: 1 },
])('rejects invalid or unauthorized proposal fields: %j', (p) => {
  expect(SettingsProposalSchema.safeParse(p).success).toBe(false);
});
