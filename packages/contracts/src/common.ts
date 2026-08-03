import { z } from 'zod';

export const EntityIdSchema = z.string().trim().min(1).max(128);
export type EntityId = z.infer<typeof EntityIdSchema>;

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const ContentHashSchema = z
  .string()
  .trim()
  .min(8)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]+$/);
export type ContentHash = z.infer<typeof ContentHashSchema>;

export const Sha256DigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, 'Expected a sha256 content digest');
export type Sha256Digest = z.infer<typeof Sha256DigestSchema>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export type JsonObject = z.infer<typeof JsonObjectSchema>;
