import { z } from 'zod';

import {
  ModelCatalogSchema,
  ModelModalitySchema,
  type ModelCatalog,
  type ModelDescriptor,
  type ModelModality,
  type ReasoningOption,
} from './ai.js';

/** The provider owns model IDs and reasoning effort names; neither is an app enum. */
export type ProviderCodexModel = Readonly<{
  id: string;
  model: string;
  displayName: string;
  description?: string;
  hidden?: boolean;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: readonly Readonly<{
    reasoningEffort: string;
    description?: string;
  }>[];
  inputModalities?: readonly string[];
  supportsPersonality?: boolean;
  upgrade?: string | Readonly<{ model: string }> | null;
  contextWindowTokens?: number | null;
  contextWindow?: number | null;
  nativeMaxContextWindowTokens?: number;
  nativeDefaultContextWindowTokens?: number;
  nativeEffectiveContextPercent?: number;
}>;

export const CODEX_FALLBACK_CONTEXT_WINDOW_TOKENS = 128_000;
/** Explicit GOSU extended-context request; not proof of account entitlement.
 * Verified 2026-09-13: https://developers.openai.com/api/docs/models/gpt-6-astra
 * Unknown models keep provider metadata; never extrapolate a family name. */
export function extendedCodexContextWindow(modelId: string | null | undefined) {
  return modelId === 'gpt-6-astra' ? 1_050_000 : undefined;
}

const modelIdSchema = z.string().trim().min(1).max(256);
const contextWindowSchema = z.number().int().positive().nullable().optional();
const wireModelSchema = z.object({
  id: modelIdSchema,
  model: modelIdSchema,
  displayName: z.string().trim().min(1).max(256),
  description: z.string().optional(),
  hidden: z.boolean().optional(),
  isDefault: z.boolean(),
  defaultReasoningEffort: z.string().trim().min(1).max(128).optional(),
  supportedReasoningEfforts: z
    .array(
      z.object({
        reasoningEffort: z.string().trim().min(1).max(128),
        description: z.string().optional(),
      }),
    )
    .optional(),
  inputModalities: z.array(z.string()).optional(),
  supportsPersonality: z.boolean().optional(),
  upgrade: z
    .union([modelIdSchema, z.object({ model: modelIdSchema })])
    .nullable()
    .optional(),
  contextWindowTokens: contextWindowSchema,
  contextWindow: contextWindowSchema,
  nativeMaxContextWindowTokens: z.number().int().positive().max(2_000_000).optional(),
  nativeDefaultContextWindowTokens: z.number().int().positive().max(2_000_000).optional(),
  nativeEffectiveContextPercent: z.number().int().min(1).max(100).optional(),
});

/** A browser-safe change fingerprint, not a cryptographic integrity receipt. */
function catalogFingerprint(value: unknown): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return `codex-catalog-v1-${hash.toString(16).padStart(16, '0')}`;
}

/** Normalize the native model/list response identically in browser and desktop consumers. */
export function createCodexModelCatalog(
  wireModels: readonly ProviderCodexModel[],
  fetchedAt = new Date().toISOString(),
): ModelCatalog {
  const visible = wireModels
    .filter((model) => !model.hidden)
    .map((model) => wireModelSchema.parse(model));
  const seenModelIds = new Set<string>();
  const normalized = visible.map((model) => {
    if (seenModelIds.has(model.id)) throw new Error(`duplicate_provider_model_id:${model.id}`);
    seenModelIds.add(model.id);

    const supportedReasoningEfforts = model.supportedReasoningEfforts ?? [];
    const seenReasoningIds = new Set<string>();
    const reasoningOptions = supportedReasoningEfforts.map((option) => {
      if (seenReasoningIds.has(option.reasoningEffort)) {
        throw new Error(`duplicate_provider_reasoning_id:${model.id}:${option.reasoningEffort}`);
      }
      seenReasoningIds.add(option.reasoningEffort);
      return {
        id: option.reasoningEffort,
        label: option.reasoningEffort,
        isDefault: option.reasoningEffort === model.defaultReasoningEffort,
      };
    });
    const modalities = [...new Set(model.inputModalities ?? ['text'])].filter(
      (modality): modality is ModelModality => ModelModalitySchema.safeParse(modality).success,
    );
    const replacementModelId =
      typeof model.upgrade === 'string' ? model.upgrade : model.upgrade?.model;
    const documentedWindow =
      extendedCodexContextWindow(model.id) ?? extendedCodexContextWindow(model.model);
    const defaultWindow =
      model.contextWindowTokens ?? model.contextWindow ?? model.nativeDefaultContextWindowTokens;
    const nativeWindow = model.nativeMaxContextWindowTokens ?? defaultWindow;
    const requestedWindow = documentedWindow
      ? Math.max(documentedWindow, nativeWindow ?? 0)
      : nativeWindow;
    const effectivePercent = model.nativeEffectiveContextPercent ?? 100;

    return {
      schemaVersion: 1 as const,
      providerId: 'codex',
      modelId: model.id,
      displayName: model.displayName,
      isDefault: model.isDefault,
      modalities: modalities.length > 0 ? modalities : ['text' as const],
      reasoningOptions,
      // Plan conservatively until execution reports the result of the extended request.
      contextWindowTokens: nativeWindow
        ? Math.floor((nativeWindow * effectivePercent) / 100)
        : (requestedWindow ?? CODEX_FALLBACK_CONTEXT_WINDOW_TOKENS),
      ...(replacementModelId ? { replacementModelId } : {}),
      metadata: {
        source: 'codex-app-server-model-list',
        ...(requestedWindow ? { requestedContextWindowTokens: requestedWindow } : {}),
        ...(requestedWindow
          ? {
              requestedEffectiveContextWindowTokens: Math.floor(
                (requestedWindow * effectivePercent) / 100,
              ),
            }
          : {}),
        ...(defaultWindow ? { defaultContextWindowTokens: defaultWindow } : {}),
        ...(documentedWindow ? { documentedContextWindowTokens: documentedWindow } : {}),
        contextConfigurationKey: catalogFingerprint([
          'codex-context-v2',
          model.model,
          requestedWindow,
          nativeWindow,
          effectivePercent,
        ]),
        ...(model.nativeMaxContextWindowTokens
          ? { nativeContextWindowTokens: model.nativeMaxContextWindowTokens }
          : {}),
        contextWindowSource:
          model.nativeMaxContextWindowTokens ||
          model.nativeDefaultContextWindowTokens ||
          documentedWindow
            ? 'configured'
            : (model.contextWindowTokens ?? model.contextWindow)
              ? 'provider'
              : 'fallback',
        wireModel: model.model,
        supportsPersonality: model.supportsPersonality ?? false,
        ...(model.description === undefined ? {} : { description: model.description }),
        reasoningDescriptions: Object.fromEntries(
          supportedReasoningEfforts.map((option) => [
            option.reasoningEffort,
            option.description ?? '',
          ]),
        ),
      },
    };
  });

  const catalogVersion = catalogFingerprint(normalized);
  return ModelCatalogSchema.parse({
    schemaVersion: 1,
    providerId: 'codex',
    catalogVersion,
    fetchedAt,
    models: normalized.map((model) => ({ ...model, catalogVersion })),
  });
}

export type CatalogModelSelection = Readonly<{
  requestedModelId?: string | null;
  providerId?: string | null;
}>;

/** Auto follows the provider default. An unavailable explicit pin stays unavailable. */
export function selectCatalogModel(
  catalog: ModelCatalog,
  selection: CatalogModelSelection = {},
): ModelDescriptor | undefined {
  return selectCatalogModelFromList(catalog.models, selection, catalog.providerId);
}

/** The same selector for the reduced descriptors rendered by existing desktop pickers. */
export function selectCatalogModelFromList<
  T extends Readonly<{ modelId: string; providerId?: string; isDefault: boolean }>,
>(
  models: readonly T[],
  selection: CatalogModelSelection = {},
  catalogProviderId?: string,
): T | undefined {
  const candidates = models.filter(
    (model) =>
      (!selection.providerId || (model.providerId ?? 'codex') === selection.providerId) &&
      (selection.requestedModelId ? model.modelId === selection.requestedModelId : model.isDefault),
  );
  if (candidates.length === 1) return candidates[0];
  // A merged catalog can contain duplicate IDs or provider-local defaults. Resolve only
  // when its own provider disambiguates; never silently choose a different provider.
  const providerCandidates = candidates.filter(
    (model) => (model.providerId ?? 'codex') === catalogProviderId,
  );
  return providerCandidates.length === 1 ? providerCandidates[0] : undefined;
}

/** Preserve provider-owned effort names and never substitute for an unavailable explicit effort. */
export function resolveCatalogReasoning(
  model: ModelDescriptor | null | undefined,
  optionId?: string | null,
): ReasoningOption | undefined {
  return model?.reasoningOptions.find((option) =>
    optionId ? option.id === optionId : option.isDefault,
  );
}
