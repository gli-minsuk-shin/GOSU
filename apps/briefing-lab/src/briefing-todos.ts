import { z } from 'zod';
export const BriefingTodoSchema = z.object({
  id: z.string().max(300),
  title: z.string().max(1000),
  projectName: z.string().max(300),
  status: z.enum(['backlog', 'planned', 'in_progress', 'review', 'done']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueDate: z.string().max(40).optional(),
});
export const BriefingTodosSchema = z.object({
  items: z.array(BriefingTodoSchema).max(200),
  limited: z.boolean(),
  fetchedAt: z.string().datetime(),
});
export type BriefingTodo = z.infer<typeof BriefingTodoSchema>;
export type TodoReader = () => Promise<z.infer<typeof BriefingTodosSchema>>;
export function upcomingTodos(items: readonly BriefingTodo[], endDay: string) {
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
  return items
    .filter((t) => t.status !== 'done' && (!t.dueDate || t.dueDate.slice(0, 10) <= endDay))
    .sort(
      (a, b) =>
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        rank[a.priority ?? 'medium'] - rank[b.priority ?? 'medium'],
    );
}
