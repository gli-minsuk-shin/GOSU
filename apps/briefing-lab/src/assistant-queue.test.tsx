import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantQueue } from './assistant-queue';
import { BriefingChat } from './briefing-chat';
import { initialRealWorkspace } from './workspace-defaults';
import { sourceRequest } from './live-client';
import { workspaceStream } from './workspace-client';
import { reserveBriefingFileDrop } from './briefing-file-drop';
import type { AssistantQueuedMessage, AssistantQueueState } from './assistant-queue-contract';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
vi.mock('./workspace-client', () => ({ workspaceStream: vi.fn() }));
vi.mock('./briefing-file-drop', () => ({ reserveBriefingFileDrop: vi.fn() }));
let ui: ReactTestRenderer;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const item: AssistantQueuedMessage = {
  id: '11111111-1111-4111-8111-111111111111',
  routineId: 'r',
  owner: 'owner',
  scope: 'scope',
  prompt: 'Queued question',
  attachmentIds: [],
  revision: 0,
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
  state: 'queued',
};
const state: AssistantQueueState = { items: [item], active: true, canSteer: true, canAttach: true };
it('edits, deletes, prioritizes and steers as distinct queue actions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const action = vi.fn().mockResolvedValue(undefined);
  await act(() => {
    ui = create(<AssistantQueue state={state} action={action} />);
  });
  const click = async (name: string) =>
    act(() =>
      ui.root
        .findAllByType('button')
        .find((b) => b.children.join('') === name)!
        .props.onClick(),
    );
  await click('수정');
  await act(() => ui.root.findByType('textarea').props.onChange({ target: { value: 'Edited' } }));
  await click('저장');
  expect(action).toHaveBeenLastCalledWith('edit', item, 'Edited');
  await click('먼저 실행');
  expect(action).toHaveBeenLastCalledWith('next', item, undefined);
  await click('현재 작업에 보충');
  expect(action).toHaveBeenLastCalledWith('steer', item, undefined);
  await click('삭제');
  expect(action).toHaveBeenLastCalledWith('delete', item, undefined);
});
it('attaches native-picker documents and accepts another question while answering', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialRealWorkspace('2026-09-13T00:00:00Z').routines[0]!;
  const file = {
    id: '22222222-2222-4222-8222-222222222222',
    projectId: 'b13f1000-0000-4000-8000-000000000001',
    sessionId: '33333333-3333-4333-8333-333333333333',
    kind: 'document',
    format: 'text',
    mediaType: 'text/plain',
    displayName: 'fixture.txt',
    byteSize: 5,
    sha256: 'a'.repeat(64),
    unitLabel: 'part',
    unitCount: 1,
    extractedCharacters: 5,
    truncated: false,
    textAvailable: true,
    visualAvailable: false,
    expiresAt: '2026-09-14T00:00:00Z',
  };
  vi.mocked(sourceRequest).mockImplementation(async (path) => {
    if (path.endsWith('/get')) return { messages: [] } as never;
    if (path.endsWith('/list')) return { ...state, active: false, items: [] } as never;
    if (path.endsWith('/choose')) return { attachments: [file] } as never;
    return {} as never;
  });
  vi.mocked(workspaceStream).mockImplementation(
    (_p, _v, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  );
  await act(() => {
    ui = create(<BriefingChat routine={routine} onSettings={() => undefined} />);
  });
  await act(() =>
    ui.root
      .findAllByType('button')
      .find((b) => b.props['aria-label'] === '파일 첨부')!
      .props.onClick(),
  );
  expect(JSON.stringify(ui.toJSON())).toContain('fixture.txt');
  await act(() =>
    ui.root.findByType('textarea').props.onChange({ target: { value: 'Read file' } }),
  );
  await act(() => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(vi.mocked(workspaceStream).mock.calls[0]?.[1]).toMatchObject({ attachmentIds: [file.id] });
  await act(() =>
    ui.root.findByType('textarea').props.onChange({ target: { value: 'Next question' } }),
  );
  await act(() => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  expect(sourceRequest).toHaveBeenCalledWith(
    '/assistant/queue/enqueue',
    expect.objectContaining({ prompt: 'Next question', attachmentIds: [] }),
  );
  expect(workspaceStream).toHaveBeenCalledOnce();
});

it('drops into the assistant without sending and preserves its draft', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialRealWorkspace('2026-09-13T00:00:00Z').routines[0]!;
  const id = '22222222-2222-4222-8222-222222222222';
  vi.mocked(reserveBriefingFileDrop).mockResolvedValue(id);
  vi.mocked(sourceRequest).mockImplementation(async (path) => {
    if (path.endsWith('/get')) return { messages: [] } as never;
    if (path.endsWith('/list')) return { ...state, active: false, items: [] } as never;
    if (path.endsWith('/drop'))
      return {
        attachments: [
          {
            id,
            projectId: 'b13f1000-0000-4000-8000-000000000001',
            sessionId: id,
            kind: 'document',
            format: 'text',
            mediaType: 'text/plain',
            displayName: 'drop.txt',
            byteSize: 1,
            sha256: 'a'.repeat(64),
            unitLabel: 'part',
            unitCount: 1,
            extractedCharacters: 1,
            truncated: false,
            textAvailable: true,
            visualAvailable: false,
            expiresAt: '2026-09-14T00:00:00Z',
          },
        ],
      } as never;
    return {} as never;
  });
  await act(() => {
    ui = create(<BriefingChat routine={routine} onSettings={() => undefined} />);
  });
  await act(() =>
    ui.root.findByType('textarea').props.onChange({ target: { value: 'Keep my question' } }),
  );
  const event = {
    dataTransfer: { types: ['Files'], files: [new File(['x'], 'drop.txt')] },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  await act(async () => {
    ui.root.findByProps({ 'aria-label': 'Briefing AI 대화' }).props.onDrop(event);
  });
  expect(reserveBriefingFileDrop).toHaveBeenCalledWith(routine.id, event.dataTransfer.files);
  expect(sourceRequest).toHaveBeenCalledWith('/assistant/attachments/drop', {
    routineId: routine.id,
    ticket: id,
  });
  expect(ui.root.findByType('textarea').props.value).toBe('Keep my question');
  expect(JSON.stringify(ui.toJSON())).toContain('drop.txt');
  expect(workspaceStream).not.toHaveBeenCalled();
});
