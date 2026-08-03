import { z } from 'zod';

import { EntityIdSchema, IsoDateTimeSchema, JsonObjectSchema } from './common.js';
import type { JsonObject } from './common.js';

export const ModelModalitySchema = z.enum(['text', 'image', 'audio', 'video']);
export type ModelModality = z.infer<typeof ModelModalitySchema>;

export const ReasoningOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    label: z.string().trim().min(1).max(128),
    isDefault: z.boolean(),
  })
  .strict();
export type ReasoningOption = z.infer<typeof ReasoningOptionSchema>;

/**
 * A provider-discovered model. `modelId` is deliberately opaque: callers must
 * populate model pickers from the provider catalog rather than an app enum.
 */
export const ModelDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    providerId: EntityIdSchema,
    modelId: z.string().trim().min(1).max(256),
    displayName: z.string().trim().min(1).max(256),
    catalogVersion: z.string().trim().min(1).max(128),
    isDefault: z.boolean(),
    modalities: z.array(ModelModalitySchema).min(1),
    reasoningOptions: z.array(ReasoningOptionSchema),
    contextWindowTokens: z.number().int().positive().optional(),
    deprecatedAt: IsoDateTimeSchema.nullable().optional(),
    replacementModelId: z.string().trim().min(1).max(256).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>;

export const ModelCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    providerId: EntityIdSchema,
    catalogVersion: z.string().trim().min(1).max(128),
    fetchedAt: IsoDateTimeSchema,
    models: z.array(ModelDescriptorSchema),
  })
  .strict();
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;

export const ModelInvocationSchema = z
  .object({
    schemaVersion: z.literal(1),
    invocationId: EntityIdSchema,
    providerId: EntityIdSchema,
    requestedModelId: z.string().trim().min(1).max(256).nullable(),
    resolvedModelId: z.string().trim().min(1).max(256),
    catalogVersion: z.string().trim().min(1).max(128),
    reasoningOptionId: z.string().trim().min(1).max(128).nullable(),
    startedAt: IsoDateTimeSchema,
  })
  .strict();
export type ModelInvocation = z.infer<typeof ModelInvocationSchema>;

export const LLMAuthStateSchema = z.enum([
  'signed_out',
  'pending',
  'signed_in',
  'expired',
  'error',
]);
export type LLMAuthState = z.infer<typeof LLMAuthStateSchema>;

export interface LLMProviderAdapter {
  readonly providerId: string;
  authState(): Promise<LLMAuthState>;
  login(): Promise<void>;
  listModels(): Promise<ModelCatalog>;
  startThread(input: { projectId: string; title?: string }): Promise<string>;
  runTurn(input: {
    threadId: string;
    prompt: string;
    requestedModelId: string | null;
    reasoningOptionId: string | null;
  }): Promise<{ invocation: ModelInvocation }>;
  streamEvents(threadId: string): AsyncIterable<JsonObject>;
  cancel(threadId: string): Promise<void>;
}
