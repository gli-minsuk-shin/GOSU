import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calendarBridgeSources } from './package-calendar-bridge.mjs';
test('packages the exact Calendar native sources without evaluating TypeScript', async () => {
  const text = await readFile(
    new URL('../apps/briefing-lab/calendar-native.ts', import.meta.url),
    'utf8',
  );
  const { source, plist } = calendarBridgeSources(text);
  assert.ok(source.startsWith('import Foundation'));
  assert.ok(source.includes('trustedGosuParent'));
  assert.ok(plist.includes('science.gosu.briefing-calendar'));
  assert.throws(() => calendarBridgeSources('const SOURCE = `invalid`;'));
  assert.throws(() => calendarBridgeSources(text.replace('import Foundation', '${untrusted}')));
});
