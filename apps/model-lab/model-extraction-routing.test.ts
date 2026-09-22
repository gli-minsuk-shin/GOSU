import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultModelRouting, ModelRoutingSchema } from '@gosu/contracts';
import { modelExtractionSelection } from './model-extraction-routing';
import { modelBuilderUserFacingError } from './model-copilot-server';
import { applicationLanguageContext } from '../desktop/src/main/application-language-service';
const current = { providerId: 'codex', requestedModelId: 'pinned-chat', reasoningOptionId: 'high' };
const fast = { providerId: 'codex' as const, modelId: 'fast-test', reasoningOptionId: 'low' };
const strong = {
  providerId: 'claude-code' as const,
  modelId: 'strong-test',
  reasoningOptionId: 'high',
};
it.each(['fast', 'strong'] as const)(
  'uses the explicitly configured %s extraction role instead of a chat pin',
  (role) => {
    const policy = {
      ...defaultModelRouting(),
      fast,
      strong,
      usage: { ...defaultModelRouting().usage, modelExtraction: role },
    };
    const model = policy[role];
    expect(modelExtractionSelection(policy, current)).toEqual({
      providerId: model.providerId,
      requestedModelId: model.modelId,
      reasoningOptionId: model.reasoningOptionId,
    });
  },
);
it('preserves legacy files and the existing selection when no extraction role is configured', () => {
  const policy = defaultModelRouting();
  delete policy.usage.modelExtraction;
  expect(ModelRoutingSchema.parse(policy)).toEqual(policy);
  expect(modelExtractionSelection(policy, current)).toBe(current);
  expect(modelExtractionSelection(undefined, undefined)).toBeUndefined();
  expect(modelExtractionSelection(defaultModelRouting(), current)).toBe(current);
});
it('does not fall back to a different model for an empty role or unsupported provider', () => {
  const policy = {
    ...defaultModelRouting(),
    usage: { ...defaultModelRouting().usage, modelExtraction: 'fast' as const },
  };
  expect(() => modelExtractionSelection(policy, current)).toThrow(
    'model_extraction_role_unconfigured',
  );
  expect(
    ModelRoutingSchema.safeParse({ ...policy, fast: { ...fast, providerId: 'hermes' } }).success,
  ).toBe(false);
  expect(() =>
    modelExtractionSelection({ ...policy, fast: { ...fast, providerId: 'hermes' } }, current),
  ).toThrow('model_extraction_provider_unsupported');
});
it('explains missing roles in the selected application language', () => {
  expect(
    applicationLanguageContext.run({ language: 'ko', configured: true }, () =>
      modelBuilderUserFacingError('model_extraction_role_unconfigured'),
    ),
  ).toContain('GOSU 설정');
  expect(
    applicationLanguageContext.run({ language: 'en', configured: true }, () =>
      modelBuilderUserFacingError('model_extraction_provider_unsupported'),
    ),
  ).toContain('Codex and Claude Code');
});
it('applies routing at the extraction endpoint and retains cache-before-LLM reuse', () => {
  const source = readFileSync(new URL('./model-copilot-server.ts', import.meta.url), 'utf8');
  const builder = source.slice(source.indexOf('if (url === MODEL_BUILDER_ENDPOINT)'));
  expect(builder).toContain('modelExtractionSelection(await modelRouting?.(), selection)');
  expect(builder.indexOf('readModelBuilderCache')).toBeGreaterThan(0);
  expect(builder.indexOf('readModelBuilderCache')).toBeLessThan(
    builder.indexOf('modelExtractionSelection'),
  );
  expect(builder).toContain('runModelBuilderSingleflight(');
});
