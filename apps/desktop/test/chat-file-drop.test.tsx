import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatFileDrop } from '../src/renderer/src/chat-file-drop';
import { droppedAttachmentPaths } from '../src/preload/dropped-attachment-paths';
let ui: ReactTestRenderer;
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.unstubAllGlobals();
});
it('highlights nested file drags, prevents navigation, attaches once on drop and leaves text drags alone', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const attach = vi.fn(async () => undefined);
  function Harness({ enabled = true }) {
    const drop = useChatFileDrop(enabled, attach);
    return <section {...drop.handlers} data-dragging={drop.dragging} />;
  }
  await act(() => {
    ui = create(<Harness />);
  });
  const file = new File(['fixture'], 'fixture.txt'),
    event = {
      dataTransfer: { types: ['Files'], files: [file], dropEffect: '' },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
  await act(() => {
    ui.root.findByType('section').props.onDragEnter(event);
    ui.root.findByType('section').props.onDragEnter(event);
    ui.root.findByType('section').props.onDragLeave(event);
  });
  expect(ui.root.findByType('section').props['data-dragging']).toBe(true);
  await act(() => ui.root.findByType('section').props.onDrop(event));
  expect(attach).toHaveBeenCalledExactlyOnceWith([file]);
  expect(ui.root.findByType('section').props['data-dragging']).toBe(false);
  event.preventDefault.mockClear();
  await act(() =>
    ui.root
      .findByType('section')
      .props.onDrop({ ...event, dataTransfer: { ...event.dataTransfer, types: ['text/plain'] } }),
  );
  expect(event.preventDefault).not.toHaveBeenCalled();
  await act(() => ui.update(<Harness enabled={false} />));
  await act(() => ui.root.findByType('section').props.onDrop(event));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(attach).toHaveBeenCalledOnce();
});
it('preload resolves only native-backed file objects, not arbitrary path properties or synthetic files', () => {
  const file = new File(['x'], 'fixture.txt');
  expect(droppedAttachmentPaths([file], () => '/native/fixture.txt')).toEqual([
    '/native/fixture.txt',
  ]);
  expect(() => droppedAttachmentPaths([file], () => '')).toThrow('attachment_invalid');
  expect(() => droppedAttachmentPaths(Array(6).fill(file), () => '/native/file')).toThrow(
    'attachment_too_many',
  );
  expect(() =>
    droppedAttachmentPaths([{ path: '/private/secret' } as unknown as File], () => {
      throw new Error('not a native File');
    }),
  ).toThrow();
});
