import { z } from 'zod';

import {
  ProjectToolActivitySchema,
  type ProjectToolActivity,
} from '../shared/project-tool-activity';
import {
  RemoteWorkspaceFilePathSchema,
  RemoteWorkspaceSubdirectorySchema,
  SSH_WORKSPACE_FILE_LIST_MAX_ENTRIES,
  SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS,
} from '../shared/ssh-workspace-contracts';
import { LiteratureSearchInputTagsSchema } from '../shared/literature-search-tags';
import { LITERATURE_MAX_SEARCH_RESULTS } from '../shared/literature-contracts';
import {
  PROJECT_CHAT_MAX_ATTACHMENT_UNITS,
  PROJECT_CHAT_MAX_ATTACHMENT_UNITS_PER_TOOL_CALL,
  PROJECT_CHAT_MAX_ATTACHMENT_CHARACTERS_PER_TOOL_CALL,
} from '../shared/project-chat-attachment-contracts';

const boundedInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const readRange = {
  offset: boundedInteger.optional(),
  maxCharacters: boundedInteger.min(1).max(24_000).optional(),
};
// Fail closed: unknown tools/keys never turn raw arguments into UI telemetry.
const argumentSchemas: Readonly<Record<string, z.ZodType>> = {
  read_workspace: z
    .object({ section: z.enum(['summary', 'board', 'objective']).default('summary') })
    .strict(),
  list_local_notes: z
    .object({
      query: z.string().max(256).optional(),
      limit: boundedInteger.min(1).max(100).optional(),
    })
    .strict(),
  read_local_note: z.object({ noteId: z.string().regex(/^[0-9a-f]{64}$/u), ...readRange }).strict(),
  list_ssh_workspaces: z.object({}).strict(),
  read_ssh_workspace_resources: z.object({ grantId: z.string().uuid() }).strict(),
  list_ssh_workspace_files: z
    .object({
      grantId: z.string().uuid(),
      workspaceSubdirectory: RemoteWorkspaceSubdirectorySchema.optional(),
      maxEntries: boundedInteger.min(1).max(SSH_WORKSPACE_FILE_LIST_MAX_ENTRIES).optional(),
    })
    .strict(),
  read_ssh_workspace_file: z
    .object({
      grantId: z.string().uuid(),
      workspaceSubdirectory: RemoteWorkspaceSubdirectorySchema.optional(),
      relativePath: RemoteWorkspaceFilePathSchema,
      ...readRange,
      maxCharacters: boundedInteger.min(1).max(SSH_WORKSPACE_FILE_READ_MAX_CHARACTERS).optional(),
    })
    .strict(),
  list_turn_attachments: z.object({}).strict(),
  read_turn_attachment_text: z
    .object({
      attachmentId: z.string().uuid(),
      startUnit: boundedInteger.min(1).max(PROJECT_CHAT_MAX_ATTACHMENT_UNITS).optional(),
      unitCount: boundedInteger
        .min(1)
        .max(PROJECT_CHAT_MAX_ATTACHMENT_UNITS_PER_TOOL_CALL)
        .optional(),
      maxCharacters: boundedInteger
        .min(1)
        .max(PROJECT_CHAT_MAX_ATTACHMENT_CHARACTERS_PER_TOOL_CALL)
        .optional(),
    })
    .strict(),
  search_literature: z
    .object({
      query: z.string().trim().min(1).max(1000),
      searchTags: LiteratureSearchInputTagsSchema.optional(),
      fromYear: boundedInteger.min(1000).max(3000).optional(),
      toYear: boundedInteger.min(1000).max(3000).optional(),
      limit: boundedInteger.min(3).max(LITERATURE_MAX_SEARCH_RESULTS).optional(),
    })
    .strict()
    .refine((args) => !args.fromYear || !args.toYear || args.fromYear <= args.toYear),
  list_experiment_runs: z
    .object({
      limit: boundedInteger.min(1).max(100).optional(),
      status: z
        .enum(['queued', 'running', 'verifying', 'succeeded', 'failed', 'cancelled', 'lost'])
        .optional(),
    })
    .strict(),
  list_manuscript_checkpoint_files: z
    .object({ manuscriptId: z.string().uuid(), checkpointId: z.string().uuid() })
    .strict(),
  read_manuscript_checkpoint_file: z
    .object({
      manuscriptId: z.string().uuid(),
      checkpointId: z.string().uuid(),
      relativePath: RemoteWorkspaceFilePathSchema,
      ...readRange,
    })
    .strict(),
};

const safeErrorCodes = new Set([
  'invalid_tool_arguments',
  'tool_timeout',
  'tool_cancelled',
  'tool_execution_failed',
  'tool_result_invalid',
  'tool_delivery_failed',
  'tool_failed',
  'ssh_cancelled',
  'ssh_command_failed',
  'experiment_run_failed',
  'experiment_run_cancelled',
  'experiment_run_lost',
  'ssh_unavailable',
  'ssh_workspace_grant_not_found',
  'ssh_workspace_file_not_allowed',
  'ssh_workspace_file_invalid',
  'ssh_workspace_file_helper_unavailable',
  'attachment_expired',
  'attachment_text_not_available',
  'local_notes_turn_budget_exhausted',
  'local_notes_not_authorized',
  'local_notes_authorization_stale',
  'vault_grant_stale',
  'vault_note_not_found',
  'vault_not_selected',
  'vault_root_changed',
  'project_not_found',
  'project_archived',
  'project_trashed',
  'vault_file_changed_during_open',
  'markdown_too_large',
  'tool_not_allowed',
  'literature_search_cancelled',
  'experiment_unavailable',
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Display only a short single line; suppress secret-like values and local paths entirely. */
function displayText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  const text = value
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (
    !text ||
    /(?:\b(?:api[_ -]?key|access[_ -]?token|password|secret|authorization|bearer)\b|\b(?:[a-z_][a-z0-9_]*(?:token|key|secret|password|credentials?|authorization)[a-z0-9_]*|token|key|credentials?)\s*[:=]|\b(?:sk-|gh[pousr]_|github_pat_|glpat-|xox[baprs]-|AIza)[a-z0-9_-]+|\beyJ[a-z0-9_-]{5,}\.|-----BEGIN|https?:\/\/|file:\/\/|(?:^|[\s"'`([{=,:;<>])(?:\/|~[\\/]|[a-z]:[\\/]|\\\\)|[a-z0-9_-]{40,})/iu.test(
      text,
    )
  )
    return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeActivity(value: ProjectToolActivity): ProjectToolActivity | undefined {
  const candidate = Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
  const parsed = ProjectToolActivitySchema.safeParse(candidate);
  return parsed.success && Object.keys(parsed.data).length ? parsed.data : undefined;
}

/** Reapply privacy constraints at the notification boundary, including legacy/provider events. */
export function sanitizeProjectToolActivity(value: unknown): ProjectToolActivity | undefined {
  try {
    const parsed = ProjectToolActivitySchema.safeParse(value);
    if (!parsed.success) return undefined;
    return safeActivity({
      ...parsed.data,
      target: displayText(parsed.data.target, 240),
      query: displayText(parsed.data.query, 160),
      errorCode:
        parsed.data.errorCode && safeErrorCodes.has(parsed.data.errorCode)
          ? parsed.data.errorCode
          : undefined,
    });
  } catch {
    return undefined;
  }
}

export function projectToolStartedActivity(
  tool: string,
  arguments_: unknown,
): ProjectToolActivity | undefined {
  try {
    const parsed = Object.hasOwn(argumentSchemas, tool)
      ? argumentSchemas[tool]?.safeParse(arguments_)
      : undefined;
    if (!parsed?.success) return undefined;
    const args = record(parsed.data);
    if (!args) return undefined;
    return safeActivity({
      ...(tool === 'read_workspace'
        ? { section: args.section as ProjectToolActivity['section'] }
        : {}),
      ...(['list_local_notes', 'search_literature'].includes(tool)
        ? { query: displayText(args.query, 160) }
        : {}),
      ...(['read_ssh_workspace_file', 'read_manuscript_checkpoint_file'].includes(tool)
        ? { target: displayText(args.relativePath, 240) }
        : tool === 'list_ssh_workspace_files'
          ? { target: displayText(args.workspaceSubdirectory, 240) }
          : {}),
      ...(typeof args.offset === 'number' ? { offset: args.offset } : {}),
      ...(typeof args.limit === 'number'
        ? { limit: args.limit }
        : typeof args.maxEntries === 'number'
          ? { limit: args.maxEntries }
          : typeof args.maxCharacters === 'number'
            ? { limit: args.maxCharacters }
            : {}),
    });
  } catch {
    return undefined;
  }
}

function resultBody(result: unknown) {
  const outer = record(result);
  if (!Array.isArray(outer?.contentItems) || outer.contentItems.length !== 1) return undefined;
  const item = record(outer.contentItems[0]);
  if (item?.type !== 'inputText' || typeof item.text !== 'string' || item.text.length > 96_000)
    return undefined;
  try {
    return record(JSON.parse(item.text));
  } catch {
    return undefined;
  }
}

/** Known broker receipts can describe a failed operation despite successful transport delivery. */
function operationFailure(tool: string, body: Record<string, unknown> | undefined) {
  if (tool === 'run_ssh_workspace_command') {
    return typeof body?.exitCode === 'number' &&
      Number.isInteger(body.exitCode) &&
      body.exitCode !== 0
      ? 'ssh_command_failed'
      : undefined;
  }
  if (tool !== 'execute_experiment_run') return undefined;
  const process = record(body?.process);
  const run = record(body?.run);
  for (const state of [run?.status, process?.outcome]) {
    if (state === 'cancelled') return 'experiment_run_cancelled';
    if (state === 'lost') return 'experiment_run_lost';
    if (state === 'failed') return 'experiment_run_failed';
  }
  return typeof process?.exitCode === 'number' &&
    Number.isInteger(process.exitCode) &&
    process.exitCode !== 0
    ? 'experiment_run_failed'
    : undefined;
}

export function projectToolCompletedActivity(
  tool: string,
  arguments_: unknown,
  result: unknown,
  failureCode?: string,
): { success: boolean; activity?: ProjectToolActivity | undefined } {
  // Diagnostics must not throw, affect delivery, or copy a raw result into notifications.
  try {
    const body = resultBody(result);
    const operationError = operationFailure(tool, body);
    const success =
      failureCode === undefined &&
      operationError === undefined &&
      record(result)?.success === true &&
      body?.ok !== false &&
      body?.success !== false &&
      !body?.error;
    const activity: ProjectToolActivity = { ...projectToolStartedActivity(tool, arguments_) };
    if (!success) {
      const code = failureCode ?? body?.error ?? operationError;
      activity.errorCode =
        typeof code === 'string' && safeErrorCodes.has(code) ? code : 'tool_failed';
      return { success, activity: safeActivity(activity) };
    }
    // Only accepted known requests get target/result enrichment.
    if (
      !Object.hasOwn(argumentSchemas, tool) ||
      !argumentSchemas[tool]?.safeParse(arguments_).success ||
      !body
    )
      return { success, activity: safeActivity(activity) };
    const counts: NonNullable<ProjectToolActivity['counts']> = [];
    const count = (
      kind: NonNullable<ProjectToolActivity['counts']>[number]['kind'],
      value: unknown,
    ) => {
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
        counts.push({ kind, value });
    };
    if (tool === 'read_workspace') {
      const board = record(body.board);
      if (Array.isArray(board?.tasks)) count('tasks', board.tasks.length);
      else count('tasks', board?.activeTaskCount);
      if (typeof board?.truncated === 'boolean') activity.truncated = board.truncated;
    }
    if (tool === 'list_local_notes' && Array.isArray(body.notes)) count('notes', body.notes.length);
    if (['list_ssh_workspace_files', 'list_manuscript_checkpoint_files'].includes(tool)) {
      const files = body.entries ?? body.files;
      if (Array.isArray(files)) count('files', files.length);
    }
    if (tool === 'list_turn_attachments' && Array.isArray(body.attachments))
      count('attachments', body.attachments.length);
    if (tool === 'list_experiment_runs' && Array.isArray(body.runs))
      count('runs', body.runs.length);
    if (tool === 'search_literature') count('papers', body.foundCount);
    if (
      [
        'read_local_note',
        'read_turn_attachment_text',
        'read_ssh_workspace_file',
        'read_manuscript_checkpoint_file',
      ].includes(tool)
    ) {
      if (typeof body.content === 'string') count('characters', [...body.content].length);
      if (typeof body.offset === 'number' && Number.isSafeInteger(body.offset) && body.offset >= 0)
        activity.offset = body.offset;
      if (tool === 'read_local_note') activity.target = displayText(body.title, 240);
      if (tool === 'read_turn_attachment_text') activity.target = displayText(body.label, 240);
    }
    if (typeof body.truncated === 'boolean') activity.truncated = body.truncated;
    if (counts.length) activity.counts = counts;
    return { success, activity: safeActivity(activity) };
  } catch {
    return { success: false };
  }
}

export function projectToolProgressTiming(startedAt: number) {
  const now = Date.now();
  return {
    occurredAt: new Date(now).toISOString(),
    elapsedMs: Math.max(0, Math.trunc(now - startedAt)),
  };
}
