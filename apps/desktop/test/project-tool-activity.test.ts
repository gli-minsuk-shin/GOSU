import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  projectToolCompletedActivity,
  projectToolProgressTiming,
  projectToolStartedActivity,
  sanitizeProjectToolActivity,
} from '../src/main/project-tool-activity';
import {
  ProjectToolActivitySchema,
  ProjectToolProgressMetadataSchema,
} from '../src/shared/project-tool-activity';
import { ProjectChatEventSchema } from '../src/shared/project-chat-contracts';

const result = (body: unknown, success = true) => ({
  success,
  contentItems: [{ type: 'inputText', text: JSON.stringify(body) }],
});
const grantId = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.restoreAllMocks());

describe('safe project tool activity', () => {
  it.each(['summary', 'board', 'objective'] as const)(
    'names the %s workspace section without copying content',
    (section) => {
      expect(projectToolStartedActivity('read_workspace', { section })).toEqual({ section });
      expect(
        projectToolCompletedActivity(
          'read_workspace',
          { section },
          result({ board: { tasks: [{ title: 'private task body' }], truncated: true } }),
        ),
      ).toEqual({
        success: true,
        activity: { section, counts: [{ kind: 'tasks', value: 1 }], truncated: true },
      });
    },
  );
  it('defaults workspace section and counts summary tasks, not board columns', () => {
    expect(projectToolStartedActivity('read_workspace', {})).toEqual({ section: 'summary' });
    expect(
      projectToolCompletedActivity(
        'read_workspace',
        {},
        result({ board: { activeTaskCount: 14, archivedTaskCount: 300 } }),
      ).activity?.counts,
    ).toEqual([{ kind: 'tasks', value: 14 }]);
  });
  it('uses actual note counts, safe titles, offsets, truncation and unicode character counts', () => {
    expect(
      projectToolStartedActivity('list_local_notes', { query: 'gradient\nreview', limit: 12 }),
    ).toEqual({ query: 'gradient review', limit: 12 });
    expect(
      projectToolCompletedActivity(
        'list_local_notes',
        { limit: 12 },
        result({ notes: [{ title: 'private' }, {}], truncated: true }),
      ).activity,
    ).toEqual({ limit: 12, counts: [{ kind: 'notes', value: 2 }], truncated: true });
    expect(
      projectToolCompletedActivity(
        'read_local_note',
        { noteId: 'a'.repeat(64), offset: 30, maxCharacters: 100 },
        result({
          title: 'Gradient review',
          content: '가😀b',
          offset: 30,
          truncated: false,
          root: '/Users/private/secret',
        }),
      ).activity,
    ).toEqual({
      target: 'Gradient review',
      offset: 30,
      limit: 100,
      counts: [{ kind: 'characters', value: 3 }],
      truncated: false,
    });
  });
  it('only exposes validated relative SSH paths and bounded counts', () => {
    const args = { grantId, relativePath: 'src/model.py', offset: 20, maxCharacters: 100 };
    expect(projectToolStartedActivity('read_ssh_workspace_file', args)).toEqual({
      target: 'src/model.py',
      offset: 20,
      limit: 100,
    });
    expect(
      projectToolStartedActivity('read_ssh_workspace_file', {
        ...args,
        relativePath: '/Users/private/model.py',
      }),
    ).toBeUndefined();
    expect(
      projectToolStartedActivity('read_ssh_workspace_file', {
        ...args,
        relativePath: '../private.py',
      }),
    ).toBeUndefined();
    expect(
      projectToolCompletedActivity(
        'list_ssh_workspace_files',
        { grantId, workspaceSubdirectory: 'src', maxEntries: 20 },
        result({ entries: [{ secret: 'must not copy' }], truncated: false }),
      ).activity,
    ).toEqual({
      target: 'src',
      limit: 20,
      counts: [{ kind: 'files', value: 1 }],
      truncated: false,
    });
  });
  it.each([
    'password=abc123',
    'Bearer abc',
    'sk-secretvalue',
    '/Users/name/notes',
    'https://user:password@example.com',
    'x'.repeat(60),
  ])('does not expose secret-like query %s', (query) => {
    expect(projectToolStartedActivity('list_local_notes', { query })).toBeUndefined();
    const completed = projectToolCompletedActivity(
      'read_local_note',
      { noteId: 'a'.repeat(64) },
      result({ title: query, content: 'body' }),
    );
    expect(completed.activity?.target).toBeUndefined();
  });
  it('bounds allowed display strings and strips control characters', () => {
    const query = 'Korean 연구 '.repeat(20);
    expect(projectToolStartedActivity('list_local_notes', { query })?.query?.length).toBe(160);
    expect(
      projectToolStartedActivity('list_local_notes', { query: 'read\u202e\u0000this' })?.query,
    ).toBe('read this');
  });
  it.each([
    'path=/Users/alice/private',
    'note (/Users/alice/private)',
    '"/Users/alice/private"',
    'path="C:\\Users\\alice\\private"',
    'note [~/private]',
    'path=\\\\server\\private',
    'GITHUB_TOKEN=ghp_abcdefghijklmno',
    'AWS_ACCESS_KEY_ID=short-value',
    'token: abc123',
    'credentials=/private/config',
    'ghp_abcdefghijklmno',
    'github_pat_abcdefg',
    'glpat-abcdefg',
    'xoxb-123456789',
    'AIza123456789',
    'eyJhbGciOiJIUzI1NiJ9.abcdef.signature',
  ])('suppresses embedded path or credential metadata %s', (query) => {
    expect(projectToolStartedActivity('list_local_notes', { query })).toBeUndefined();
    const completed = projectToolCompletedActivity(
      'read_local_note',
      { noteId: 'a'.repeat(64) },
      result({ title: query, content: 'data' }),
    );
    expect(completed.activity?.target).toBeUndefined();
    expect(sanitizeProjectToolActivity({ target: query, query })).toBeUndefined();
  });
  it('retains ordinary relative paths and research terms after privacy filtering', () => {
    expect(
      sanitizeProjectToolActivity({
        target: 'src/film_model.py',
        query: 'key findings on query/key attention',
      }),
    ).toEqual({ target: 'src/film_model.py', query: 'key findings on query/key attention' });
  });
  it('does not expose unknown tools, unknown keys, invalid requests or prompts', () => {
    expect(
      projectToolStartedActivity('unknown_tool', { query: 'safe but unknown' }),
    ).toBeUndefined();
    expect(
      projectToolStartedActivity('read_workspace', { section: 'board', prompt: 'do anything' }),
    ).toBeUndefined();
    expect(
      projectToolStartedActivity('list_local_notes', { query: 'safe', limit: -1 }),
    ).toBeUndefined();
    expect(
      projectToolCompletedActivity(
        'unknown_tool',
        {},
        result({ title: 'hidden', notes: [{}], content: 'secret', truncated: true }),
      ).activity,
    ).toBeUndefined();
  });
  it('uses attachment and literature metadata without forwarding bodies or tags', () => {
    expect(
      projectToolCompletedActivity(
        'list_turn_attachments',
        {},
        result({ attachments: [{ name: '/private.pdf' }] }),
      ).activity?.counts,
    ).toEqual([{ kind: 'attachments', value: 1 }]);
    expect(
      projectToolCompletedActivity(
        'search_literature',
        { query: 'neural gradient', limit: 3 },
        result({ foundCount: 2, papers: [{ abstract: 'private' }] }),
      ).activity,
    ).toEqual({ query: 'neural gradient', limit: 3, counts: [{ kind: 'papers', value: 2 }] });
  });
  it('distinguishes failed broker receipts from successfully settled transports', () => {
    expect(
      projectToolCompletedActivity(
        'read_workspace',
        {},
        result({ ok: false, error: 'ssh_cancelled', raw: 'private failure details' }),
      ),
    ).toEqual({ success: false, activity: { section: 'summary', errorCode: 'ssh_cancelled' } });
    expect(
      projectToolCompletedActivity(
        'read_workspace',
        {},
        result({ error: 'arbitrary_secret_error' }),
      ),
    ).toEqual({ success: false, activity: { section: 'summary', errorCode: 'tool_failed' } });
    expect(
      projectToolCompletedActivity(
        'read_workspace',
        {},
        result({ board: { tasks: [{}] } }),
        'tool_timeout',
      ),
    ).toEqual({ success: false, activity: { section: 'summary', errorCode: 'tool_timeout' } });
  });
  it.each([
    [
      'run_ssh_workspace_command',
      { exitCode: 1, stderr: '/Users/private/error', stdout: 'private stdout' },
      'ssh_command_failed',
    ],
    ['run_ssh_workspace_command', { exitCode: -1 }, 'ssh_command_failed'],
    [
      'execute_experiment_run',
      { process: { outcome: 'failed', exitCode: null }, run: { status: 'failed' } },
      'experiment_run_failed',
    ],
    [
      'execute_experiment_run',
      { process: { outcome: 'verifying', exitCode: 1 } },
      'experiment_run_failed',
    ],
    [
      'execute_experiment_run',
      { process: { outcome: 'succeeded', exitCode: 0 }, run: { status: 'failed' } },
      'experiment_run_failed',
    ],
    ['execute_experiment_run', { process: { outcome: 'cancelled' } }, 'experiment_run_cancelled'],
    ['execute_experiment_run', { run: { status: 'lost' } }, 'experiment_run_lost'],
  ] as const)(
    'reports %s failed operation even when transport succeeded',
    (tool, body, errorCode) => {
      const receipt = result(body);
      const before = JSON.stringify(receipt);
      const completed = projectToolCompletedActivity(tool, {}, receipt);
      expect(completed).toEqual({ success: false, activity: { errorCode } });
      expect(sanitizeProjectToolActivity(completed.activity)).toEqual({ errorCode });
      expect(JSON.stringify(receipt)).toBe(before);
      expect(JSON.stringify(completed)).not.toContain('private');
    },
  );
  it('does not infer failed operations from unrelated tool content or successful receipts', () => {
    expect(
      projectToolCompletedActivity('run_ssh_workspace_command', {}, result({ exitCode: 0 }))
        .success,
    ).toBe(true);
    expect(
      projectToolCompletedActivity(
        'execute_experiment_run',
        {},
        result({ process: { outcome: 'succeeded', exitCode: 0 }, run: { status: 'succeeded' } }),
      ).success,
    ).toBe(true);
    expect(
      projectToolCompletedActivity(
        'unknown_tool',
        {},
        result({ exitCode: 1, process: { outcome: 'failed' } }),
      ).success,
    ).toBe(true);
  });
  it.each([
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
  ])('retains the known broker failure %s without copying its private body', (errorCode) => {
    const completed = projectToolCompletedActivity(
      'read_local_note',
      { noteId: 'a'.repeat(64) },
      result(
        {
          error: errorCode,
          message: 'private body /Users/name/vault',
          content: 'password=private',
        },
        false,
      ),
    );
    expect(completed).toEqual({ success: false, activity: { errorCode } });
    expect(sanitizeProjectToolActivity(completed.activity)).toEqual({ errorCode });
    expect(JSON.stringify(completed)).not.toContain('private');
  });

  it('never throws or copies invalid/oversized results into telemetry', () => {
    const throwing = Object.defineProperty({}, 'success', {
      get() {
        throw new Error('unsafe getter');
      },
    });
    expect(() => projectToolCompletedActivity('read_workspace', {}, throwing)).not.toThrow();
    expect(
      projectToolCompletedActivity('read_workspace', {}, result({ board: { activeTaskCount: -4 } }))
        .activity?.counts,
    ).toBeUndefined();
    expect(
      projectToolCompletedActivity(
        'read_workspace',
        {},
        result({ content: 'a'.repeat(100_000), title: 'secret' }),
      ).activity,
    ).toEqual({ section: 'summary' });
  });
  it('measures completion time on the host and clamps wall-clock rollback', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    expect(projectToolProgressTiming(1750)).toEqual({
      occurredAt: '1970-01-01T00:00:02.000Z',
      elapsedMs: 250,
    });
    expect(projectToolProgressTiming(5000).elapsedMs).toBe(0);
  });
  it('preserves legacy events and strictly rejects raw/invalid extra metadata', () => {
    const event = {
      type: 'agent.progress',
      projectId: grantId,
      sessionId: grantId,
      turnId: 'turn1',
      stage: 'tool_started',
      tool: 'read_workspace',
      callId: 'call1',
    };
    expect(ProjectChatEventSchema.safeParse(event).success).toBe(true);
    expect(
      ProjectChatEventSchema.safeParse({
        ...event,
        activity: { section: 'board' },
        occurredAt: '2026-09-08T10:00:00.000Z',
        elapsedMs: 4,
      }).success,
    ).toBe(true);
    expect(ProjectToolActivitySchema.safeParse({ target: 'x', rawArguments: {} }).success).toBe(
      false,
    );
    expect(
      ProjectToolActivitySchema.safeParse({ counts: [{ kind: 'files', value: -1 }] }).success,
    ).toBe(false);
    expect(ProjectToolProgressMetadataSchema.safeParse({ elapsedMs: -1 }).success).toBe(false);
    expect(ProjectToolProgressMetadataSchema.safeParse({ occurredAt: 'yesterday' }).success).toBe(
      false,
    );
  });
});
