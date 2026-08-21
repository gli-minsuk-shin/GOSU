import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  archiveHermesRuntimeBundle,
  prepareHermesRuntime,
  verifyHermesRuntimeArchive,
  verifyHermesRuntimeBundle,
} from './hermes-runtime-bundle.mjs';

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const destinationDirectory = resolve(
  process.env.GOSU_HERMES_BUNDLE_DESTINATION ??
    `${workspaceRoot}/apps/desktop/.runtime/hermes-runtime`,
);
const sourceDirectory = process.env.GOSU_HERMES_BUNDLE_SOURCE?.trim();
const required = process.argv.includes('--required');
const archivePath = resolve(
  process.env.GOSU_HERMES_BUNDLE_ARCHIVE ??
    `${workspaceRoot}/apps/desktop/.runtime/hermes-runtime.zip`,
);

if (!sourceDirectory) {
  const manifestPath = resolve(destinationDirectory, 'gosu-hermes-runtime.json');
  const manifestExists = await stat(manifestPath).then(
    (value) => value.isFile(),
    (error) => {
      if (error && typeof error === 'object' && error.code === 'ENOENT') return false;
      throw error;
    },
  );
  if (manifestExists) {
    const verified = await verifyHermesRuntimeBundle(destinationDirectory);
    await archiveHermesRuntimeBundle(destinationDirectory, archivePath);
    await verifyHermesRuntimeArchive(archivePath);
    console.log(
      `verified prepared Hermes ${verified.manifest.hermesVersion} runtime: ${destinationDirectory}`,
    );
  } else {
    if (required) {
      throw new Error(
        'GOSU_HERMES_BUNDLE_SOURCE must point to a reviewed, relocatable Hermes runtime for release packaging.',
      );
    }
    await rm(destinationDirectory, { recursive: true, force: true });
    await mkdir(destinationDirectory, { recursive: true });
    await writeFile(archivePath, 'GOSU development build: Hermes runtime unavailable.\n');
    console.warn('No bundled Hermes runtime prepared; development package will use BYO fallback.');
  }
} else {
  const manifest = await prepareHermesRuntime({
    sourceDirectory: resolve(sourceDirectory),
    destinationDirectory,
  });
  await archiveHermesRuntimeBundle(destinationDirectory, archivePath);
  await verifyHermesRuntimeArchive(archivePath);
  console.log(
    `prepared Hermes ${manifest.hermesVersion} ${manifest.platform}/${manifest.arch} runtime: ${destinationDirectory}`,
  );
}
