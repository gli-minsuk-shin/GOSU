import { z } from 'zod';

import { EntityIdSchema, IsoDateTimeSchema, JsonObjectSchema } from './common.js';

export const SyncEventV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: EntityIdSchema,
    idempotencyKey: z.string().trim().min(8).max(256),
    labId: EntityIdSchema,
    projectId: EntityIdSchema,
    actorId: EntityIdSchema,
    entityType: z.string().trim().min(1).max(128),
    entityId: EntityIdSchema,
    entityVersion: z.number().int().positive(),
    eventType: z.string().trim().min(1).max(128),
    occurredAt: IsoDateTimeSchema,
    payload: JsonObjectSchema,
  })
  .strict();
export type SyncEventV1 = z.infer<typeof SyncEventV1Schema>;
