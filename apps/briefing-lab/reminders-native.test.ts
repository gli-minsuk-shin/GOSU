import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('separates Reminders authorization from Calendar and deduplicates a chosen-list create before writing', () => {
  const source = readFileSync(new URL('./calendar-native.ts', import.meta.url), 'utf8');
  expect(source).toContain('NSRemindersFullAccessUsageDescription');
  expect(source).toContain('store.requestFullAccessToReminders');
  expect(source.indexOf('if action.hasPrefix("reminders_")')).toBeLessThan(
    source.indexOf('let status=EKEventStore.authorizationStatus(for: .event)'),
  );
  expect(source).toContain('store.predicateForReminders(in:[list])');
  expect(source.indexOf('if let prior=matches.first')).toBeLessThan(
    source.indexOf('try store.save(reminder,commit:true)'),
  );
  expect(source).toContain('reminders_read_incomplete');
  expect(source).toContain('list.allowsContentModifications');
  expect(source).toContain('q["dueAt"] as? String');
  expect(source).toContain('[.year,.month,.day,.hour,.minute,.second]');
  expect(source).toContain('components.timeZone=calendar.timeZone');
});
