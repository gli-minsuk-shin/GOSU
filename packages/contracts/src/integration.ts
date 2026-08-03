import { z } from 'zod';

import { EntityIdSchema } from './common.js';

export const ConnectorCapabilitiesSchema = z
  .object({
    read: z.boolean(),
    write: z.boolean(),
    attachments: z.boolean(),
    realtime: z.boolean(),
    export: z.boolean(),
  })
  .strict();
export type ConnectorCapabilities = z.infer<typeof ConnectorCapabilitiesSchema>;

export const ConnectorDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    connectorId: EntityIdSchema,
    displayName: z.string().trim().min(1).max(128),
    capabilities: ConnectorCapabilitiesSchema,
  })
  .strict();
export type ConnectorDescriptor = z.infer<typeof ConnectorDescriptorSchema>;
