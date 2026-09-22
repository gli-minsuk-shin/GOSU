import { z } from 'zod';
export const BriefingTaskCreateSchema = z
  .object({
    routineId: z.string().min(1).max(128),
    sourceKey: z.string().min(1).max(300),
    requestId: z.string().uuid(),
    projectId: z.string().uuid().nullable(),
    title: z.string().trim().min(2).max(240),
    notes: z.string().trim().max(4000),
    dueDate: z.string().date().nullable(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    reminderListId: z.string().min(1).max(500).nullable(),
  })
  .strict()
  .refine((v) => !v.dueAt || Boolean(v.dueDate), {
    message: '마감 시간을 지정하려면 마감일이 필요합니다.',
  });
export type BriefingTaskCreate = z.infer<typeof BriefingTaskCreateSchema>;
export type ReminderList = { id: string; name: string; source: string; writable: boolean };
export type BriefingTaskOptions = {
  reminderDefaults?: { enabled: boolean; listId: string };
  warning?: string;
  projects: { id: string; name: string }[];
  authorized: boolean;
  lists: ReminderList[];
  defaultListId: string;
};
export type BriefingTaskResult = {
  taskId: string;
  reminderState: 'created' | 'existing' | 'skipped' | 'failed' | 'uncertain';
  message: string;
};
export type BriefingTaskActions = {
  configure?(
    input: { enabled: boolean; listId: string },
    signal: AbortSignal,
    guard: () => Promise<void>,
  ): Promise<{ enabled: boolean; listId: string }>;
  options(signal: AbortSignal, authorize: boolean): Promise<BriefingTaskOptions>;
  create(
    input: BriefingTaskCreate,
    signal: AbortSignal,
    guard: () => Promise<void>,
  ): Promise<BriefingTaskResult>;
};
