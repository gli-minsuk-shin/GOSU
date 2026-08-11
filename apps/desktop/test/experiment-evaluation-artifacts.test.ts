import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalExperimentEvaluationArtifacts } from '../src/main/experiment-evaluation-artifacts';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LocalExperimentEvaluationArtifacts', () => {
  it('atomically saves bounded code and prompt files with private permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gosu-evaluation-artifacts-'));
    roots.push(root);
    const projectId = '11111111-1111-4111-8111-111111111111';
    const profileId = '22222222-2222-4222-8222-222222222222';
    const writer = new LocalExperimentEvaluationArtifacts(() => root);

    const saved = await writer.saveProfile({
      projectId,
      profileId,
      fileName: 'holdout_eval.py',
      code: 'print("safe")',
      prompt: 'Evaluate the reviewed holdout.',
    });

    const profileRoot = join(root, projectId, profileId);
    expect(saved).toEqual({
      codePath: `evaluation-profiles/${projectId}/${profileId}/holdout_eval.py`,
      promptPath: `evaluation-profiles/${projectId}/${profileId}/evaluation-prompt.txt`,
    });
    expect(await readFile(join(profileRoot, 'holdout_eval.py'), 'utf8')).toBe('print("safe")\n');
    expect(await readFile(join(profileRoot, 'evaluation-prompt.txt'), 'utf8')).toBe(
      'Evaluate the reviewed holdout.\n',
    );
    expect((await stat(profileRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(join(profileRoot, 'holdout_eval.py'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(profileRoot, 'evaluation-prompt.txt'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(profileRoot, '.gosu-profile-pending'))).isFile()).toBe(true);
    expect(
      await writer.verifyProfile({
        projectId,
        profileId,
        fileName: 'holdout_eval.py',
        code: 'print("safe")',
        prompt: 'Evaluate the reviewed holdout.',
        ...saved,
      }),
    ).toBe(true);
    await writer.finalizeProfile({ projectId, profileId });
    await expect(stat(join(profileRoot, '.gosu-profile-pending'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await writeFile(join(profileRoot, 'holdout_eval.py'), 'print("changed")\n');
    expect(
      await writer.verifyProfile({
        projectId,
        profileId,
        fileName: 'holdout_eval.py',
        code: 'print("safe")',
        prompt: 'Evaluate the reviewed holdout.',
        ...saved,
      }),
    ).toBe(false);
  });

  it('refuses path-shaped identities and removes only the exact profile on rollback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gosu-evaluation-artifacts-'));
    roots.push(root);
    const projectId = '11111111-1111-4111-8111-111111111111';
    const profileId = '22222222-2222-4222-8222-222222222222';
    const writer = new LocalExperimentEvaluationArtifacts(() => root);

    await expect(
      writer.saveProfile({
        projectId: '../escape',
        profileId,
        fileName: 'eval.py',
        code: 'pass',
        prompt: 'safe',
      }),
    ).rejects.toThrow('experiment_evaluation_artifact_input_invalid');

    await writer.saveProfile({
      projectId,
      profileId,
      fileName: 'eval.py',
      code: 'pass',
      prompt: 'safe',
    });
    await writer.rollbackProfile({ projectId, profileId });

    await expect(stat(join(root, projectId, profileId))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(join(root, projectId))).isDirectory()).toBe(true);
  });

  it('rejects a symlinked project directory instead of following it outside the artifact root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gosu-evaluation-artifacts-'));
    const outside = await mkdtemp(join(tmpdir(), 'gosu-evaluation-artifacts-outside-'));
    roots.push(root, outside);
    const projectId = '11111111-1111-4111-8111-111111111111';
    const profileId = '22222222-2222-4222-8222-222222222222';
    await chmod(outside, 0o755);
    await symlink(outside, join(root, projectId), 'dir');
    const writer = new LocalExperimentEvaluationArtifacts(() => root);

    await expect(
      writer.saveProfile({
        projectId,
        profileId,
        fileName: 'eval.py',
        code: 'pass',
        prompt: 'safe',
      }),
    ).rejects.toThrow('experiment_evaluation_artifact_directory_invalid');
    await expect(stat(join(outside, profileId))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(outside)).mode & 0o777).toBe(0o755);
  });

  it('reconciles crash-pending directories against persisted profile identities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gosu-evaluation-artifacts-'));
    roots.push(root);
    const projectId = '11111111-1111-4111-8111-111111111111';
    const brokenProfileId = '11111111-1111-4111-8111-111111111112';
    const validProfileId = '22222222-2222-4222-8222-222222222222';
    const orphanProfileId = '33333333-3333-4333-8333-333333333333';
    const writer = new LocalExperimentEvaluationArtifacts(() => root);
    for (const profileId of [brokenProfileId, validProfileId, orphanProfileId]) {
      await writer.saveProfile({
        projectId,
        profileId,
        fileName: 'eval.py',
        code: 'def evaluate(values):\n    return values',
        prompt: 'Evaluate structured values.',
      });
    }

    const result = await writer.reconcilePendingProfiles(
      (candidateProjectId, candidateProfileId) => {
        if (candidateProfileId === brokenProfileId) throw new Error('fixture lookup failure');
        return candidateProjectId === projectId && candidateProfileId === validProfileId;
      },
    );

    expect(result).toEqual({ finalized: 1, removed: 1, failures: 1 });
    expect((await stat(join(root, projectId, brokenProfileId))).isDirectory()).toBe(true);
    expect((await stat(join(root, projectId, validProfileId))).isDirectory()).toBe(true);
    await expect(
      stat(join(root, projectId, validProfileId, '.gosu-profile-pending')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, projectId, orphanProfileId))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
