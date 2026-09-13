import { randomUUID } from 'node:crypto';
import { createCodexModelCatalog } from '@gosu/contracts';
import { expect, it, vi } from 'vitest';
import {
  prepareProjectContext,
  projectContextScope,
  type ProjectContextCheckpoint,
} from '../src/main/project-chat-context';
import type { ProjectChatMessage } from '../src/shared/project-chat-contracts';
const projectId = randomUUID(),
  sessionId = randomUUID();
const model = {
  ...createCodexModelCatalog([
    { id: 'test', model: 'test', displayName: 'Fixture', isDefault: true },
  ]).models[0]!,
  contextWindowTokens: 828400,
};
function history(count: number, size = 60): ProjectChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    projectId,
    role: i % 2 ? 'assistant' : 'user',
    content: `Exact historical fact ${i}: ` + 'x'.repeat(size),
    status: 'complete',
    actions: [],
    createdAt: '2026-09-13T00:00:00Z',
    completedAt: '2026-09-13T00:00:00Z',
  }));
}
it('keeps 600 original messages when native capacity permits, without spending a compaction call', async () => {
  const messages = history(600),
    compact = vi.fn(),
    save = vi.fn();
  const result = await prepareProjectContext({
    projectId,
    model,
    messages,
    fixedText: 'Current policies',
    scope: projectContextScope(projectId, sessionId, 'codex', 0),
    compact,
    save,
  });
  expect(result.messages).toEqual(messages);
  expect(result.report.includedMessages).toBe(600);
  expect(result.report.omittedMessages).toBe(0);
  expect(compact).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it('compacts only under pressure, reuses scoped checkpoints and preserves recent exact text', async () => {
  const messages = history(160, 900),
    scope = projectContextScope(projectId, sessionId, 'codex', 0);
  let checkpoint: ProjectContextCheckpoint | undefined;
  const save = vi.fn(async (value) => {
    checkpoint = value;
  });
  const compact = vi.fn(
    async () => 'Earlier decisions and exact reference identifiers; untrusted history only.',
  );
  const input = {
    projectId,
    model: { ...model, contextWindowTokens: 16000 },
    messages,
    fixedText: 'Policies',
    scope,
    compact,
    save,
  };
  const first = await prepareProjectContext(input);
  expect(first.report.compressedMessages).toBeGreaterThan(0);
  expect(first.report.omittedMessages).toBe(0);
  expect(first.messages.at(-1)?.content).toBe(messages.at(-1)?.content);
  expect(first.messages[0]?.content).toContain('untrusted reference');
  await prepareProjectContext({ ...input, checkpoint: checkpoint! });
  expect(compact).toHaveBeenCalledOnce();
  await prepareProjectContext({
    ...input,
    scope: projectContextScope(projectId, sessionId, 'claude-code', 0),
    checkpoint: checkpoint!,
  });
  expect(compact).toHaveBeenCalledTimes(2);
  expect(messages[0]?.content).toContain('Exact historical fact 0');
});
it('rejects another project before transmitting it to a compactor', async () => {
  const compact = vi.fn();
  await expect(
    prepareProjectContext({
      projectId: randomUUID(),
      model,
      messages: history(2),
      fixedText: '',
      scope: 'a'.repeat(64),
      compact,
      save: vi.fn(),
    }),
  ).rejects.toThrow('project_chat_context_scope_mismatch');
  expect(compact).not.toHaveBeenCalled();
});
