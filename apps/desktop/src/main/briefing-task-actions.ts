import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { WorkspaceService } from './workspace-service';
import { CreateTaskInputSchema } from '../shared/workspace-contracts';
import { SealedStateStore } from '../../../briefing-lab/sealed-state-store';
import { runCalendarNative } from '../../../briefing-lab/calendar-native';
import {
  BriefingTaskCreateSchema,
  type BriefingTaskActions,
  type BriefingTaskResult,
} from '../../../briefing-lab/src/briefing-task-actions';
const StateSchema = z.object({
  revision: z.number().int(),
  reminderDefaults: z
    .object({ enabled: z.boolean(), listId: z.string().max(500) })
    .default({ enabled: false, listId: '' }),
  entries: z
    .array(z.object({ id: z.string().uuid(), digest: z.string().length(64), created: z.boolean() }))
    .max(10000),
});
const CatalogSchema = z.object({
  authorized: z.boolean(),
  defaultListId: z.string(),
  lists: z
    .array(
      z.object({
        id: z.string().max(500),
        name: z.string().max(300),
        source: z.string().max(300),
        writable: z.boolean(),
      }),
    )
    .max(200),
});
export class DesktopBriefingTaskActions implements BriefingTaskActions {
  private state: SealedStateStore<z.infer<typeof StateSchema>>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private workspace: Pick<WorkspaceService, 'snapshot' | 'createTask' | 'refreshCommittedState'>,
    directory: string,
    private native = runCalendarNative,
    keyProvider?: (directory: string) => Promise<Buffer>,
  ) {
    this.state = new SealedStateStore(
      directory,
      {
        file: 'task-links.v1.enc.json',
        version: 1,
        aad: 'gosu.briefing-task-links.v1',
        empty: () => ({
          revision: 0,
          entries: [],
          reminderDefaults: { enabled: false, listId: '' },
        }),
        parse: (v) => StateSchema.parse(v),
        maxBytes: 8000000,
      },
      keyProvider,
    );
  }
  async options(signal: AbortSignal, authorize = false) {
    const snapshot = await this.workspace.snapshot();
    let catalog: z.infer<typeof CatalogSchema>, warning: string | undefined;
    try {
      catalog = CatalogSchema.parse(
        await this.native(
          { action: authorize ? 'reminders_authorize' : 'reminders_catalog' },
          signal,
        ),
      );
    } catch (error) {
      if (signal.aborted) throw new Error('source_cancelled', { cause: error });
      if (authorize) throw error;
      catalog = { authorized: false, lists: [], defaultListId: '' };
      warning =
        '미리 알림 연결을 확인하지 못했습니다. GOSU에만 추가하거나 연결을 다시 확인할 수 있습니다.';
    }
    return {
      ...catalog,
      reminderDefaults: (await this.state.read()).reminderDefaults,
      ...(warning ? { warning } : {}),
      projects: snapshot.projects
        .filter((p) => !p.archivedAt && !p.trashedAt)
        .map((p) => ({ id: p.id, name: p.name })),
    };
  }
  async configure(
    input: { enabled: boolean; listId: string },
    signal: AbortSignal,
    guard: () => Promise<void>,
  ) {
    const value = z
      .object({ enabled: z.boolean(), listId: z.string().max(500) })
      .strict()
      .parse(input);
    await guard();
    if (value.enabled) {
      const options = await this.options(signal, false);
      if (!options.authorized) throw Error('reminders_permission_required');
      if (!options.lists.some((l) => l.id === value.listId && l.writable))
        throw Error('reminders_list_unavailable');
    }
    await guard();
    await this.state.mutate((s) => {
      s.reminderDefaults = value;
    }, signal);
    return value;
  }
  create(
    raw: Parameters<BriefingTaskActions['create']>[0],
    signal: AbortSignal,
    guard: () => Promise<void>,
  ): Promise<BriefingTaskResult> {
    const input = BriefingTaskCreateSchema.parse(raw);
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        await guard();
        if (signal.aborted) throw Error('source_cancelled');
        const command = CreateTaskInputSchema.parse({
          projectId: input.projectId,
          title: input.title,
          description: input.notes,
          status: 'planned',
          ...(input.dueDate ? { dueDate: input.dueDate } : {}),
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        });
        let snapshot = await this.workspace.snapshot();
        if (
          input.projectId !== null &&
          !snapshot.projects.some((p) => p.id === input.projectId && !p.archivedAt && !p.trashedAt)
        )
          throw Error('briefing_task_project_unavailable');
        // Exact full task payload only, never title-only deduplication. The selected export list may change.
        const digest = createHash('sha256')
          .update(JSON.stringify([input.routineId, input.sourceKey, command]))
          .digest('hex');
        let id = input.requestId,
          created = false;
        await this.state.mutate((s) => {
          const collision = s.entries.find((e) => e.id === id);
          if (collision && collision.digest !== digest)
            throw Error('briefing_task_request_changed');
          const existing = collision ?? s.entries.find((e) => e.digest === digest);
          if (existing) {
            id = existing.id;
            created = existing.created;
            return;
          }
          if (s.entries.length >= 10000) throw Error('briefing_task_store_full');
          s.entries.push({ id, digest, created: false });
        }, signal);
        await guard();
        let existing = snapshot.tasks.find((t) => t.id === id);
        if (existing?.archivedAt) throw Error('briefing_task_archived');
        if (!existing) {
          if (created) throw Error('briefing_task_missing');
          try {
            existing = await this.workspace.createTask(command, id);
          } catch (e) {
            snapshot = await this.workspace.refreshCommittedState();
            existing = snapshot.tasks.find((t) => t.id === id);
            if (!existing) throw e;
          }
        }
        if (existing.projectId !== input.projectId) throw Error('briefing_task_request_changed');
        if (
          existing.title !== command.title ||
          (existing.description ?? '') !== (command.description ?? '') ||
          (existing.dueDate ?? null) !== (command.dueDate ?? null) ||
          (existing.dueAt ?? null) !== (command.dueAt ?? null)
        )
          throw Error('briefing_task_request_changed');
        await this.state.mutate((s) => {
          const entry = s.entries.find((e) => e.id === id);
          if (entry) entry.created = true;
        }, signal);
        if (!input.reminderListId)
          return {
            taskId: id,
            reminderState: 'skipped' as const,
            message: 'GOSU 할 일에 추가했습니다.',
          };
        try {
          await guard();
          if (signal.aborted) throw Error('source_cancelled');
          const latest = await this.workspace.snapshot();
          if (
            (input.projectId !== null &&
              !latest.projects.some(
                (p) => p.id === input.projectId && !p.archivedAt && !p.trashedAt,
              )) ||
            !latest.tasks.some((t) => t.id === id && !t.archivedAt && t.status !== 'done')
          )
            throw Error('briefing_task_project_unavailable');
          const result = z.object({ id: z.string().min(1), existing: z.boolean() }).parse(
            await this.native(
              {
                action: 'reminders_create',
                taskId: id,
                listId: input.reminderListId,
                title: existing.title,
                notes: existing.description ?? '',
                dueDate: existing.dueDate ?? null,
                ...(existing.dueAt ? { dueAt: existing.dueAt } : {}),
              },
              signal,
            ),
          );
          return {
            taskId: id,
            reminderState: result.existing ? ('existing' as const) : ('created' as const),
            message:
              'GOSU 할 일과 Apple 미리 알림에 추가했습니다. iCloud 목록은 기기 동기화 설정에 따라 표시됩니다.',
          };
        } catch (e) {
          const known =
            e instanceof Error &&
            /reminders_(permission_required|list_unavailable)/.test(e.message);
          return {
            taskId: id,
            reminderState: known ? ('failed' as const) : ('uncertain' as const),
            message: known
              ? 'GOSU 할 일은 저장했습니다. 미리 알림 권한과 선택한 목록을 확인한 뒤 다시 시도해주세요.'
              : 'GOSU 할 일은 저장했습니다. Apple 미리 알림 결과는 확인하지 못했습니다. 같은 요청으로 다시 확인할 수 있습니다.',
          };
        }
      });
    this.queue = task;
    return task;
  }
}
