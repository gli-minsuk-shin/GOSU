import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createModelBuilderDiagnosticRun,
  MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATE_BYTES,
  readLatestModelBuilderCandidate,
  type ModelBuilderDiagnosticMetadata,
} from './model-builder-diagnostics';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const metadata: ModelBuilderDiagnosticMetadata = {
  sourceDigest: 'a'.repeat(64),
  artifacts: [
    { name: 'mochi_model.py', kind: 'python', byteLength: 4_096, sha256: 'b'.repeat(64) },
  ],
  providerId: 'codex',
  modelId: 'gpt-6-astra',
  reasoning: 'high',
};
const temporaryRoots: string[] = [];
async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'gosu-builder-diagnostics-test-'));
  temporaryRoots.push(root);
  return root;
}
async function receipt(root: string, id: string) {
  return JSON.parse(await readFile(join(root, `${id}.json`), 'utf8'));
}

afterEach(async () => {
  vi.mocked(rename).mockClear();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('Model Builder local failure journal', () => {
  it('retains failed candidates and validation errors across runs with private file permissions', async () => {
    const root = await temporaryRoot();
    const run = await createModelBuilderDiagnosticRun(metadata, root);
    const initial = await receipt(root, run.id);
    expect(initial.status).toBe('running');
    await run.event({ phase: 'llm-running', message: 'Generating the architecture.' });
    await run.candidate(1, '{"modules":[{"name":"Refinement"}]}');
    await run.event({ phase: 'model-ir-repairing', message: 'Missing source port on Refinement.' });
    await run.candidate(2, '{"modules":[{"name":"Refinement","outputPorts":[]}]}');
    await run.finish({ status: 'failed', error: 'model_ir_invalid: Missing source port' });
    const next = await createModelBuilderDiagnosticRun(metadata, root);
    expect(next.id).not.toBe(run.id);
    const saved = await receipt(root, run.id);
    expect(saved.status).toBe('failed');
    expect(saved.error).toBe('model_ir_invalid: Missing source port');
    expect(saved.candidates.map((item: { attemptNumber: number }) => item.attemptNumber)).toEqual([
      1, 2,
    ]);
    expect(saved.candidates[0].text).toContain('Refinement');
    expect(saved.metadata).toEqual(metadata);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, `${run.id}.json`))).mode & 0o777).toBe(0o600);
    expect(Object.keys(run)).not.toContain('path');
  });

  it('whitelists metadata and progress, strips source paths and redacts common credentials', async () => {
    const root = await temporaryRoot();
    const untrustedMetadata = {
      ...metadata,
      prompt: 'PRIVATE_PROMPT',
      environment: { HOME: 'PRIVATE_HOME' },
      artifacts: [
        {
          ...metadata.artifacts[0]!,
          name: '/private/upload/mochi_model.py',
          content: 'PRIVATE_SOURCE',
        },
      ],
    };
    const run = await createModelBuilderDiagnosticRun(untrustedMetadata, root);
    const progress = {
      phase: 'failed' as const,
      message: 'Credential api_key=secret-value and Bearer abc.def.xyz',
      stderr: 'PRIVATE_STDERR',
      stdout: 'PRIVATE_STDOUT',
      prompt: 'PRIVATE_PROMPT',
    };
    await run.event(progress);
    await run.candidate(1, '{"token":"sk-abcdefghijklmnopqrstuvwxyz0123456789","modules":[]}');
    await run.finish({
      status: 'failed',
      error: 'refresh_token=secret-refresh model_codex_exit_1',
    });
    const raw = await readFile(join(root, `${run.id}.json`), 'utf8');
    expect(raw).not.toMatch(
      /PRIVATE_|\/private\/upload|secret-value|abc\.def\.xyz|secret-refresh|sk-abcdefghijklmnopqrstuvwxyz/,
    );
    const saved = JSON.parse(raw);
    expect(saved.metadata.artifacts[0].name).toBe('mochi_model.py');
    expect(saved.error).toContain('model_codex_exit_1');
    expect(saved.candidates[0].text).toContain('[redacted-key]');
  });

  it('bounds event history and UTF-8 candidates while explicitly recording omitted content', async () => {
    const root = await temporaryRoot();
    const run = await createModelBuilderDiagnosticRun(metadata, root);
    await Promise.all(
      Array.from({ length: 55 }, (_, index) =>
        run.event({
          phase: 'model-ir-validating',
          message: `${index}: ${'x'.repeat(3_000)}`,
        }),
      ),
    );
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await run.candidate(attempt, '수'.repeat(MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATE_BYTES / 2));
    }
    await run.finish({ status: 'failed', error: 'e'.repeat(3_000) });
    const saved = await receipt(root, run.id);
    expect(saved.events).toHaveLength(50);
    expect(saved.events[0].message.startsWith('5:')).toBe(true);
    expect(
      saved.events.every(
        (event: { message: string; truncated: boolean }) =>
          event.message.length <= 2_000 && event.truncated,
      ),
    ).toBe(true);
    expect(saved.eventsOmitted).toBe(5);
    expect(saved.candidates).toHaveLength(3);
    expect(saved.candidatesOmitted).toBe(1);
    for (const candidate of saved.candidates) {
      expect(candidate.truncated).toBe(true);
      expect(candidate.originalBytes).toBeGreaterThan(MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATE_BYTES);
      expect(Buffer.byteLength(candidate.text, 'utf8')).toBeLessThanOrEqual(
        MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATE_BYTES,
      );
      expect(candidate.text).not.toContain('\uFFFD');
    }
    expect(saved.error).toHaveLength(2_000);
    expect(saved.errorTruncated).toBe(true);
  });

  it('keeps the last complete JSON after an interrupted atomic update and allows recovery', async () => {
    const root = await temporaryRoot();
    const run = await createModelBuilderDiagnosticRun(metadata, root);
    await run.candidate(1, '{"first":"candidate"}');
    const before = await readFile(join(root, `${run.id}.json`), 'utf8');
    vi.mocked(rename).mockRejectedValueOnce(new Error('simulated rename failure'));
    await expect(run.candidate(2, '{"second":"candidate"}')).rejects.toThrow(
      'simulated rename failure',
    );
    expect(await readFile(join(root, `${run.id}.json`), 'utf8')).toBe(before);
    expect(await readdir(root)).toEqual([`${run.id}.json`]);
    await run.finish({ status: 'failed', error: 'write recovery preserved first candidate' });
    const saved = await receipt(root, run.id);
    expect(saved.status).toBe('failed');
    expect(saved.candidates).toHaveLength(1);
    await run.event({ phase: 'llm-running', message: 'Late provider callback' });
    expect(await receipt(root, run.id)).toEqual(saved);
  });

  it('rejects malformed digests and candidate attempt numbers before writing invalid receipt fields', async () => {
    const root = await temporaryRoot();
    await expect(
      createModelBuilderDiagnosticRun({ ...metadata, sourceDigest: '../not-a-digest' }, root),
    ).rejects.toThrow('invalid_digest');
    expect(await readdir(root)).toEqual([]);
    const run = await createModelBuilderDiagnosticRun(metadata, root);
    await expect(run.candidate(-1, 'bad attempt')).rejects.toThrow('invalid_attempt');
    expect((await receipt(root, run.id)).candidates).toEqual([]);
  });

  it('resumes only the newest failed exact-source run and its latest untruncated candidate', async () => {
    const root = await temporaryRoot();
    const older = await createModelBuilderDiagnosticRun(metadata, root);
    await older.candidate(1, '{"generation":"old"}');
    await older.finish({ status: 'failed', error: 'audit failed' });
    await utimes(join(root, `${older.id}.json`), new Date(1_000), new Date(1_000));
    const latest = await createModelBuilderDiagnosticRun(metadata, root);
    await latest.candidate(1, '{"generation":"new"}');
    await latest.candidate(2, '{"generation":"repaired"}');
    await latest.finish({ status: 'failed', error: 'last repair timed out' });
    for (const state of ['complete', 'running', 'wrong-source'] as const) {
      const other = await createModelBuilderDiagnosticRun(
        {
          ...metadata,
          sourceDigest: state === 'wrong-source' ? 'c'.repeat(64) : metadata.sourceDigest,
        },
        root,
      );
      await other.candidate(1, JSON.stringify({ unwanted: state }));
      if (state !== 'running')
        await other.finish({ status: state === 'complete' ? 'complete' : 'failed' });
    }
    const result = await readLatestModelBuilderCandidate(metadata.sourceDigest, root);
    expect(result).toEqual({ runId: latest.id, candidate: '{"generation":"repaired"}' });
    expect(Object.keys(result!)).toEqual(['candidate', 'runId']);
  });

  it('skips invalid, oversized, truncated, and symlinked receipts without altering files', async () => {
    const root = await temporaryRoot();
    expect(
      await readLatestModelBuilderCandidate(metadata.sourceDigest, join(root, 'absent')),
    ).toBeNull();
    const truncated = await createModelBuilderDiagnosticRun(metadata, root);
    await truncated.candidate(1, 'x'.repeat(MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATE_BYTES + 1));
    await truncated.finish({ status: 'failed' });
    expect(await readLatestModelBuilderCandidate(metadata.sourceDigest, root)).toBeNull();
    const brokenName = '11111111-1111-1111-1111-111111111111.json';
    const bigName = '22222222-2222-2222-2222-222222222222.json';
    const linkName = '33333333-3333-3333-3333-333333333333.json';
    await writeFile(join(root, brokenName), '{ incomplete');
    await writeFile(join(root, bigName), 'x'.repeat(3_500_001));
    await symlink(join(root, `${truncated.id}.json`), join(root, linkName));
    const before = await readdir(root);
    expect(await readLatestModelBuilderCandidate(metadata.sourceDigest, root)).toBeNull();
    expect(await readLatestModelBuilderCandidate('../path', root)).toBeNull();
    expect(await readdir(root)).toEqual(before);
  });
});
