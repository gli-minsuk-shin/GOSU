import { it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodexContextMetadata } from '../src/main/codex-context-metadata';
import { createCodexModelCatalog } from '@gosu/contracts';
it('reads bounded fresh model-only context metadata and ignores stale, invalid and symlinked data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gosu-context-metadata-'));
  const path = join(dir, 'models_cache.json');
  const data = {
    fetched_at: new Date().toISOString(),
    models: [
      {
        slug: 'gpt-6-astra',
        context_window: 272000,
        max_context_window: 872000,
        effective_context_window_percent: 95,
        base_instructions: 'not exported',
      },
      { slug: 'other', max_context_window: null },
    ],
  };
  try {
    await writeFile(path, JSON.stringify(data));
    const info = (await readCodexContextMetadata(dir))[0]!;
    expect(info).toEqual({
      slug: 'gpt-6-astra',
      context_window: 272000,
      max_context_window: 872000,
      effective_context_window_percent: 95,
    });
    const model = createCodexModelCatalog([
      {
        id: info.slug,
        model: info.slug,
        displayName: 'Astra',
        isDefault: true,
        nativeMaxContextWindowTokens: info.max_context_window!,
        nativeEffectiveContextPercent: info.effective_context_window_percent!,
      },
    ]).models[0]!;
    expect(model.contextWindowTokens).toBe(828400);
    expect(model.metadata?.requestedContextWindowTokens).toBe(1050000);
    await writeFile(path, JSON.stringify({ ...data, fetched_at: '2000-01-01T00:00:00Z' }));
    expect(await readCodexContextMetadata(dir)).toEqual([]);
    await rm(path);
    await symlink(join(dir, 'nonexistent'), path);
    expect(await readCodexContextMetadata(dir)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
