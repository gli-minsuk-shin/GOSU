import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localSigningOptions } from './sign-local-mac.mjs';
test('local signing requires an exact certificate and never signs the installed app in place', () => {
  const hash = 'a'.repeat(40);
  assert.throws(() => localSigningOptions('/Applications/GOSU.app', hash));
  assert.throws(() => localSigningOptions('/private/tmp/GOSU.app', '-'));
  assert.throws(() => localSigningOptions('/private/tmp/Other.app', hash));
  const options = localSigningOptions('/private/tmp/GOSU.app', hash);
  assert.equal(options.identity, hash);
  assert.equal(options.strictVerify, true);
  assert.equal(options.preAutoEntitlements, false);
  assert.deepEqual(
    options.optionsForFile('/private/tmp/GOSU.app/Contents/Resources/CalendarBridge.app')
      .entitlements,
    [],
  );
  assert.ok(
    options.optionsForFile('/private/tmp/GOSU.app').entitlements.endsWith('entitlements.mac.plist'),
  );
});
