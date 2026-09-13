import { z } from 'zod';

export const ModelLabSelectionSchema = z
  .object({
    modelId: z.string().min(1).max(160),
    revision: z.number().int().min(0).max(1000000),
  })
  .strict();
export const ModelLabReferenceSchema = ModelLabSelectionSchema.extend({
  name: z.string().min(1).max(240),
  version: z.string().min(1).max(120),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ModelLabReference = z.infer<typeof ModelLabReferenceSchema>;
export const ModelLabReadInputSchema = z
  .object({
    section: z.enum(['catalog', 'model', 'pseudocode', 'conversation']).default('catalog'),
    modelId: z.string().min(1).max(160).optional(),
    revision: z.number().int().min(0).max(1000000).optional(),
    expectedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    offset: z.number().int().min(0).max(40000000).default(0),
  })
  .strict()
  .refine((v) => v.section === 'catalog' || Boolean(v.modelId), {
    message: 'Select a model from the catalog first.',
  });
export type ModelLabReadInput = z.input<typeof ModelLabReadInputSchema>;
export type ModelLabReadResult = {
  projectId: string;
  section: string;
  models?: Array<ModelLabReference & { revisions: number[] }>;
  reference?: ModelLabReference;
  text?: string;
  totalCharacters?: number;
  totalModels?: number;
  nextOffset?: number | null;
  historySource?: 'archive' | 'legacy-ui-cache' | 'none';
  note: string;
};
export type ModelLabReader = (
  projectId: string,
  input: ModelLabReadInput,
) => Promise<ModelLabReadResult>;

export const ModelLabChatHandoffSchema = z
  .object({
    type: z.literal('gosu:model-lab:project-chat'),
    model: ModelLabSelectionSchema,
  })
  .strict();
