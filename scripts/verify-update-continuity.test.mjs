import assert from 'node:assert/strict';
import test from 'node:test';
import { designatedRequirement, verifyIdentityContinuity } from './verify-update-continuity.mjs';
const identity = (requirement) => ({ id: 'science.gosu.desktop', requirement });
const a = identity(
  'identifier "science.gosu.desktop" and anchor apple generic and certificate leaf[subject.OU] = "TEAM"',
);
test('allows the same stable certificate requirement across app versions', () => {
  assert.equal(verifyIdentityContinuity(a, { ...a }).preservedIdentity, true);
});
test('blocks ad-hoc candidates even when a migration flag is passed', () => {
  for (const flag of [false, true])
    assert.throws(() => verifyIdentityContinuity(a, identity('cdhash H"abc"'), flag), /ad-hoc/);
  assert.throws(
    () => verifyIdentityContinuity(a, identity('identifier "science.gosu.desktop"')),
    /고정 인증서/,
  );
  assert.throws(
    () => verifyIdentityContinuity(a, identity('identifier "anchor.certificate"')),
    /고정 인증서/,
  );
  assert.throws(() => verifyIdentityContinuity(a, { ...a, adHoc: true }, true), /ad-hoc/);
});
test('requires explicit reviewed migration and never permits a different bundle ID', () => {
  const old = identity('cdhash H"old"');
  assert.throws(() => verifyIdentityContinuity(old, a), /일회성/);
  assert.equal(verifyIdentityContinuity(old, a, true).requiresOneTimeApproval, true);
  assert.throws(() => verifyIdentityContinuity(a, { ...a, id: 'other.app' }, true), /앱 식별자/);
});
test('parses signed and implicit ad-hoc requirement output and fails closed', () => {
  assert.equal(
    designatedRequirement('Executable=/Applications/GOSU.app\n# designated => cdhash H"123"\n'),
    'cdhash H"123"',
  );
  assert.equal(
    designatedRequirement('designated => anchor apple generic\n'),
    'anchor apple generic',
  );
  assert.throws(() => designatedRequirement('missing'), /확인하지/);
});
