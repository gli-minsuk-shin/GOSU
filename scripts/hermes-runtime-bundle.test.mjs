import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  HERMES_RUNTIME_INPUT_NAME,
  HERMES_RUNTIME_MANIFEST_NAME,
  HERMES_RUNTIME_SOURCE_REVISION,
  HERMES_RUNTIME_VERSION,
  archiveHermesRuntimeBundle,
  prepareHermesRuntime,
  verifyHermesRuntimeArchive,
  verifyHermesRuntimeBundle,
} from './hermes-runtime-bundle.mjs';

async function sourceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'gosu-hermes-source-'));
  await mkdir(join(root, 'python', 'bin'), { recursive: true });
  await mkdir(join(root, 'hermes-agent'), { recursive: true });
  await writeFile(join(root, 'python', 'bin', 'python3.11'), '#!/bin/sh\nexit 0\n');
  await chmod(join(root, 'python', 'bin', 'python3.11'), 0o755);
  await writeFile(
    join(root, 'hermes-agent', 'pyproject.toml'),
    `[project]\nversion = "${HERMES_RUNTIME_VERSION}"\n`,
  );
  await writeFile(join(root, 'hermes-agent', 'run_agent.py'), 'class AIAgent: pass\n');
  await writeFile(
    join(root, HERMES_RUNTIME_INPUT_NAME),
    JSON.stringify({
      schemaVersion: 1,
      hermesVersion: HERMES_RUNTIME_VERSION,
      sourceRevision: HERMES_RUNTIME_SOURCE_REVISION,
      platform: process.platform,
      arch: process.arch,
      pythonRelativePath: 'python/bin/python3.11',
      hermesRootRelativePath: 'hermes-agent',
    }),
  );
  return root;
}

test('prepares and verifies an exact relocatable Hermes runtime', async (context) => {
  const source = await sourceFixture();
  const destination = await mkdtemp(join(tmpdir(), 'gosu-hermes-destination-'));
  const archiveDirectory = await mkdtemp(join(tmpdir(), 'gosu-hermes-archive-'));
  context.after(() =>
    Promise.all(
      [source, destination, archiveDirectory].map((path) =>
        rm(path, { recursive: true, force: true }),
      ),
    ),
  );
  const manifest = await prepareHermesRuntime({
    sourceDirectory: source,
    destinationDirectory: destination,
  });
  assert.equal(manifest.hermesVersion, HERMES_RUNTIME_VERSION);
  assert.equal(manifest.files.length, 3);
  const verified = await verifyHermesRuntimeBundle(destination);
  assert.equal(verified.manifest.treeSha256, manifest.treeSha256);
  const archive = join(archiveDirectory, 'hermes-runtime.zip');
  await archiveHermesRuntimeBundle(destination, archive);
  const verifiedArchive = await verifyHermesRuntimeArchive(archive);
  assert.equal(verifiedArchive.manifest.treeSha256, manifest.treeSha256);
  assert.equal(
    JSON.parse(await readFile(join(destination, HERMES_RUNTIME_MANIFEST_NAME), 'utf8'))
      .hermesVersion,
    HERMES_RUNTIME_VERSION,
  );
});

test('rejects secrets and mutable session state from a bundle input', async (context) => {
  const source = await sourceFixture();
  const destination = await mkdtemp(join(tmpdir(), 'gosu-hermes-destination-'));
  context.after(() =>
    Promise.all([source, destination].map((path) => rm(path, { recursive: true, force: true }))),
  );
  await writeFile(join(source, '.env'), 'OPENAI_API_KEY=secret\n');
  await assert.rejects(
    prepareHermesRuntime({ sourceDirectory: source, destinationDirectory: destination }),
    /hermes_runtime_forbidden_path/,
  );
});
