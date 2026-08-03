import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { renderContractSchemaArtifacts } from '../dist/generation.js';

const outputDirectory = fileURLToPath(new URL('../generated/json-schema/', import.meta.url));
const checkOnly = process.argv.includes('--check');
const artifacts = await renderContractSchemaArtifacts();

await mkdir(outputDirectory, { recursive: true });
const existingJsonFiles = (await readdir(outputDirectory))
  .filter((file) => file.endsWith('.json'))
  .sort();

if (checkOnly) {
  const expectedFiles = Object.keys(artifacts).sort();
  const failures = [];

  if (JSON.stringify(existingJsonFiles) !== JSON.stringify(expectedFiles)) {
    failures.push(
      `file set differs\nexpected: ${expectedFiles.join(', ')}\nactual:   ${existingJsonFiles.join(', ')}`,
    );
  }

  for (const [file, expected] of Object.entries(artifacts)) {
    let actual;
    try {
      actual = await readFile(new URL(`../generated/json-schema/${file}`, import.meta.url), 'utf8');
    } catch {
      failures.push(`${file} is missing`);
      continue;
    }
    if (actual !== expected) {
      failures.push(`${file} is stale`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Generated JSON Schema drift detected:\n${failures.join('\n')}`);
  }
} else {
  const expectedFiles = new Set(Object.keys(artifacts));
  await Promise.all(
    existingJsonFiles
      .filter((file) => !expectedFiles.has(file))
      .map((file) => unlink(new URL(`../generated/json-schema/${file}`, import.meta.url))),
  );
  await Promise.all(
    Object.entries(artifacts).map(([file, contents]) =>
      writeFile(new URL(`../generated/json-schema/${file}`, import.meta.url), contents, 'utf8'),
    ),
  );
}
