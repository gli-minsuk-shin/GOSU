import { describe, expect, it, vi } from 'vitest';
import {
  assistantTodoConsent,
  assistantTodoCreator,
  assistantWorkspaceTools,
  explicitAssistantWrites,
  literaturePaper,
  type AssistantWorkspaceContext,
} from './briefing-assistant-workspace';
import type { LiveItem } from './src/live-types';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const IDEA = '22222222-2222-4222-8222-222222222222';
const signal = new AbortController().signal;
const paper: LiveItem = {
  id: 'arxiv:2401.00001',
  kind: 'papers',
  title: 'Learned LASSO Solvers',
  text: 'We predict penalized regression coefficients in one pass.',
  source: 'arXiv',
  sourceUrl: 'https://arxiv.org/abs/2401.00001v2',
  publishedAt: '2024-01-02T00:00:00Z',
  bibliography: { authors: ['A. Kim', 'B. Lee'], venue: 'ICML', source: 'arXiv' },
  readScope: 'abstract',
  details: [],
} as LiveItem;

type Overrides = {
  [K in keyof AssistantWorkspaceContext]?: AssistantWorkspaceContext[K] | undefined;
};
function setup(prompt: string, overrides: Overrides = {}) {
  const projectBridge = vi.fn(async (action: string) => ({ action, ok: true }));
  const createTodo = vi.fn(async () => ({
    taskId: 't1',
    reminderState: 'skipped' as const,
    message: 'GOSU에 추가했습니다.',
  }));
  const onWrite = vi.fn();
  const stillAllowed = vi.fn(async () => undefined);
  const tools = assistantWorkspaceTools({
    prompt,
    routineId: 'r1',
    projectRead: true,
    canPrivateAi: async () => true,
    projectBridge,
    createTodo,
    stillAllowed,
    discoveredPapers: new Map([[paper.id, paper]]),
    progress: vi.fn(),
    onWrite,
    ...(overrides as Partial<AssistantWorkspaceContext>),
  });
  return { tools, projectBridge, createTodo, onWrite, stillAllowed };
}
const names = (tools: ReturnType<typeof assistantWorkspaceTools>) =>
  tools.offered.map((tool) => tool.name);

describe('explicit write requests', () => {
  it('offers a write only when the message names it and asks to add, save or record', () => {
    expect([...explicitAssistantWrites('내일까지 초안 검토를 할 일에 추가해줘')]).toEqual(['todo']);
    expect([...explicitAssistantWrites('이 실험 결과를 연구 노트에 저장해줘')].sort()).toEqual([
      'experiment',
      'note',
    ]);
    expect([...explicitAssistantWrites('찾은 논문 두 편 논문 서재에 넣어줘')]).toEqual([
      'literature',
    ]);
    expect([...explicitAssistantWrites('record 0.42 as the metric for this idea')]).toEqual([
      'experiment',
    ]);
    // Reads, denials and how-to questions grant nothing.
    expect(explicitAssistantWrites('실험 목록 보여줘').size).toBe(0);
    expect(explicitAssistantWrites('할 일은 추가하지 마').size).toBe(0);
    expect(explicitAssistantWrites('할 일은 어떻게 추가해?').size).toBe(0);
  });

  it('keeps reads available and adds only the requested writes', () => {
    expect(names(setup('p 프로젝트 실험 상황 알려줘').tools)).toEqual([
      'read_research_notes',
      'read_literature',
      'read_manuscripts',
      'read_experiments',
    ]);
    expect(names(setup('회의 준비 할 일에 추가해줘').tools)).toContain('create_todo');
    expect(names(setup('회의 준비 할 일에 추가해줘').tools)).not.toContain('save_research_note');
    const experiment = names(setup('이 아이디어 실험에 추가하고 지표 0.4 기록해줘').tools);
    expect(experiment).toEqual(
      expect.arrayContaining(['add_experiment_idea', 'record_experiment_metric']),
    );
    // Without the project bridge only a to-do can be written, and without createTodo none.
    expect(names(setup('할 일에 추가해줘', { projectBridge: undefined }).tools)).toEqual([
      'create_todo',
    ]);
    expect(names(setup('할 일에 추가해줘', { createTodo: undefined }).tools)).not.toContain(
      'create_todo',
    );
  });
});

describe('writes', () => {
  it('creates a to-do once per identical request, with a stable request id and a receipt', async () => {
    const { tools, createTodo, onWrite } = setup('회의 준비 할 일에 추가해줘');
    const args = { title: '회의 자료 준비', dueDate: '2026-09-21', project: PROJECT };
    const receipt = await tools.execute('create_todo', args, signal);
    expect(receipt).toMatchObject({ created: true, taskId: 't1', title: '회의 자료 준비' });
    await tools.execute('create_todo', args, signal);
    expect(createTodo).toHaveBeenCalledOnce();
    expect(onWrite).toHaveBeenCalledOnce();
    const [task] = createTodo.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(task).toMatchObject({
      projectId: PROJECT,
      title: '회의 자료 준비',
      notes: '',
      dueDate: '2026-09-21',
      sourceKey: expect.stringMatching(/^assistant:/u),
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    });
    await expect(
      tools.execute('create_todo', { title: '시간만', dueAt: '2026-09-21T10:00:00+09:00' }, signal),
    ).rejects.toThrow('assistant_todo_due_date_required');
    for (const index of [1, 2, 3, 4])
      await tools.execute('create_todo', { title: `일 ${index}` }, signal);
    await expect(tools.execute('create_todo', { title: '여섯 번째' }, signal)).rejects.toThrow(
      'assistant_todo_write_limit',
    );
    expect(assistantTodoConsent({ title: '회의 자료 준비', dueDate: '2026-09-21' })).toContain(
      '마감: 2026-09-21',
    );
  });

  it('saves a note, adds discovered papers, an idea and a metric through the project bridge', async () => {
    const { tools, projectBridge, onWrite } = setup(
      '이 내용을 연구 노트에 저장하고, 논문 서재에 넣고, 실험 아이디어로 추가하고 지표 0.42 기록해줘',
    );
    await tools.execute(
      'save_research_note',
      { project: PROJECT, category: 'experiments', title: 'ABCD 정리', content: '# 결과' },
      signal,
    );
    await tools.execute(
      'save_research_note',
      { project: PROJECT, category: 'experiments', title: 'ABCD 정리', content: '# 결과' },
      signal,
    );
    await tools.execute('add_to_literature', { project: PROJECT, paperIds: [paper.id] }, signal);
    await expect(
      tools.execute('add_to_literature', { project: PROJECT, paperIds: ['invented'] }, signal),
    ).rejects.toThrow('assistant_literature_paper_not_discovered');
    await tools.execute('add_experiment_idea', { project: PROJECT, title: 'Axial off' }, signal);
    await tools.execute(
      'record_experiment_metric',
      { project: PROJECT, ideaId: IDEA, value: 0.42 },
      signal,
    );
    expect(projectBridge.mock.calls.map((call) => call[0])).toEqual([
      'note-save',
      'literature-add',
      'experiment-idea-add',
      'experiment-metric-record',
    ]);
    expect(onWrite).toHaveBeenCalledTimes(4);
    const calls = projectBridge.mock.calls as unknown as [
      string,
      string,
      string,
      AbortSignal,
      () => Promise<void>,
    ][];
    const note = JSON.parse(calls[0]![2]);
    expect(note).toEqual({
      category: 'experiments',
      title: 'ABCD 정리',
      content: '# 결과',
      idempotencyKey: expect.stringMatching(/^assistant:[0-9a-f-]{36}:[0-9a-f]{32}$/u),
    });
    // The library gets the observed metadata, never text written by the model.
    expect(JSON.parse(calls[1]![2])).toEqual({ papers: [literaturePaper(paper)] });
    expect(literaturePaper(paper)).toMatchObject({
      authors: ['A. Kim', 'B. Lee'],
      publishedYear: 2024,
      venue: 'ICML',
      sourceUrl: 'https://arxiv.org/abs/2401.00001v2',
    });
    expect(JSON.parse(calls[3]![2])).toEqual({ ideaId: IDEA, value: 0.42 });
    // Every bridge write carries a recheck of the chat's permissions.
    expect(calls.every((call) => typeof call[4] === 'function')).toBe(true);
  });

  it('refuses tools this message did not ask for, and project access without its permissions', async () => {
    const { tools, projectBridge } = setup('p 프로젝트 논문 서재 보여줘');
    await expect(
      tools.execute('add_experiment_idea', { project: PROJECT, title: 'x' }, signal),
    ).rejects.toThrow('assistant_tool_unavailable');
    await tools.execute('read_literature', { project: PROJECT, query: 'lasso' }, signal);
    expect(projectBridge).toHaveBeenCalledWith(
      'literature',
      PROJECT,
      JSON.stringify({ query: 'lasso' }),
      signal,
      expect.any(Function),
    );
    const noRead = setup('p 프로젝트 논문 서재 보여줘', { projectRead: false }).tools;
    await expect(noRead.execute('read_literature', { project: PROJECT }, signal)).rejects.toThrow(
      'assistant_project_permission_required',
    );
    const noAi = setup('p 프로젝트 원고 보여줘', { canPrivateAi: async () => false }).tools;
    await expect(noAi.execute('read_manuscripts', { project: PROJECT }, signal)).rejects.toThrow(
      'assistant_private_ai_required',
    );
  });
});

describe('to-do creator', () => {
  const task = {
    sourceKey: 'assistant:t',
    requestId: '33333333-3333-4333-8333-333333333333',
    projectId: null,
    title: '리뷰 답장',
    notes: '',
    dueDate: '2026-09-22',
  };
  const owned = { approvedScope: 'scope-1' };
  const deps = (overrides: Record<string, unknown> = {}) => {
    const create = vi.fn(
      async (_input: unknown, _signal: AbortSignal, guard: () => Promise<void>) => {
        await guard();
        return { taskId: 't', reminderState: 'created' as const, message: 'ok' };
      },
    );
    const options = vi.fn(async () => ({
      reminderDefaults: { enabled: true, listId: 'list-a' },
      lists: [{ id: 'list-a', name: 'A', source: 'iCloud', writable: true }],
      projects: [],
      authorized: true,
      defaultListId: 'list-a',
    }));
    const consent = vi.fn(async () => undefined);
    const value = {
      actions: { options, create },
      routineId: 'r1',
      approvedScope: 'scope-1',
      workspace: {
        profile: async () => owned,
        owns: () => true,
        approved: () => true,
      },
      needsConfirmation: () => false,
      consent,
      ...overrides,
    };
    return { value, create, options, consent };
  };

  it('uses the reviewed task path with the saved Reminders list, asking first only under ask', async () => {
    const { value, create, consent } = deps();
    await assistantTodoCreator(value)(task, signal);
    expect(consent).not.toHaveBeenCalled();
    expect(create.mock.calls[0]![0]).toEqual({
      ...task,
      routineId: 'r1',
      reminderListId: 'list-a',
    });
    const asking = deps({ needsConfirmation: () => true });
    await assistantTodoCreator(asking.value)(task, signal);
    expect(asking.consent).toHaveBeenCalledWith(assistantTodoConsent(task), signal);
    // A disabled or missing Reminders default adds to GOSU only.
    const noReminders = deps();
    noReminders.options.mockResolvedValueOnce({
      reminderDefaults: { enabled: false, listId: 'list-a' },
      lists: [],
      projects: [],
      authorized: false,
      defaultListId: '',
    });
    await assistantTodoCreator(noReminders.value)(task, signal);
    expect(noReminders.create.mock.calls[0]![0]).toMatchObject({ reminderListId: null });
  });

  it('stops when the routine is no longer owned, approved or in the same scope', async () => {
    for (const workspace of [
      { profile: async () => owned, owns: () => false, approved: () => true },
      { profile: async () => owned, owns: () => true, approved: () => false },
      { profile: async () => ({ approvedScope: 'other' }), owns: () => true, approved: () => true },
    ]) {
      const { value, create } = deps({ workspace });
      await expect(assistantTodoCreator(value)(task, signal)).rejects.toThrow(
        'assistant_settings_changed',
      );
      expect(create).not.toHaveBeenCalled();
    }
  });
});
