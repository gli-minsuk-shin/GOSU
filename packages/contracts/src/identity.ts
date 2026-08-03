import { z } from 'zod';

export const LabRoleSchema = z.enum(['owner', 'project_lead', 'researcher', 'reviewer', 'viewer']);
export type LabRole = z.infer<typeof LabRoleSchema>;

export const LAB_ROLES = LabRoleSchema.options;
