import { expect, it } from 'vitest';
import { assignPaperTags, buildPaperTagCatalog, cleanPaperTags } from './paper-tags';
it('consolidates aliases/spelling and retains raw keywords without modifying summaries', () => {
  const items = [
    {
      keywords: ['LLM', 'large-language-model', '대규모 언어 모델', 'diffusion models'],
      summary: 'Original',
    },
    { keywords: ['Large language models', '확산 모델'], summary: 'Other' },
  ];
  const result = cleanPaperTags(items);
  expect(
    buildPaperTagCatalog(items)
      .map((t) => t.label)
      .sort(),
  ).toEqual(['Diffusion models', 'Large language models']);
  expect(result[0]?.tags).toEqual(['Large language models', 'Diffusion models']);
  expect(result[0]?.summary).toBe('Original');
  expect(result[0]?.keywords).toEqual(items[0]?.keywords);
  expect(items[0]).not.toHaveProperty('tags');
});
it('reuses existing tags first and admits at most one genuinely unmatched label, three in total', () => {
  const catalog = buildPaperTagCatalog([{ keywords: ['Transformers', 'LLM', 'Optimization'] }]);
  expect(
    assignPaperTags(['New topic', 'Another new topic', 'LLMs', 'transformer'], catalog),
  ).toEqual(['Large language models', 'Transformers', 'New topic']);
  expect(
    assignPaperTags(['New topic', 'LLM', 'Optimization', 'transformer'], catalog),
  ).toHaveLength(3);
  expect(assignPaperTags(['paper', 'model'], catalog)).toEqual([]);
});
it('does not collapse distinct qualifiers or use tags from another provided catalog', () => {
  const catalog = buildPaperTagCatalog([{ tags: ['supervised learning', 'Bayesian inference'] }]);
  expect(assignPaperTags(['self-supervised learning'], catalog)).toEqual([
    'Self-supervised learning',
  ]);
  expect(assignPaperTags(['frequentist inference'], catalog)).toEqual(['frequentist inference']);
  expect(assignPaperTags(['Secret topic'], [], false)).toEqual([]);
  expect(assignPaperTags(['ML'], buildPaperTagCatalog([{ tags: ['Machine learning'] }]))).toEqual([
    'ML',
  ]);
});
it('rechecks the vocabulary after a serialized batch adds a new tag', () => {
  const catalog = buildPaperTagCatalog([{ keywords: ['Existing topic'] }]);
  expect(assignPaperTags(['New topic'], catalog, false)).toEqual([]);
  catalog.push({ label: 'New topic', aliases: [], count: 1 });
  expect(assignPaperTags(['NEW TOPIC'], catalog, false)).toEqual(['New topic']);
});
