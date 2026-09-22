import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MailSenderRecovery } from './mail-sender-recovery';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let root: ReactTestRenderer | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.clearAllMocks();
});
const target = { routineId: 'r', historyId: 'h', itemId: 'm' };
it('reads on explicit click only, prevents disclosure toggling and avoids duplicate requests', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    root = create(<MailSenderRecovery target={target} />);
  });
  expect(sourceRequest).not.toHaveBeenCalled();
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  let request!: Promise<void>;
  await act(async () => {
    const click = root!.root.findByType('button').props.onClick;
    request = click(event);
    void click(event);
  });
  expect(sourceRequest).toHaveBeenCalledExactlyOnceWith(
    '/mail/read-sender',
    target,
    expect.any(AbortSignal),
  );
  expect(root!.root.findByType('button').props.disabled).toBe(true);
  await act(async () => {
    finish({ sender: 'Research Office <office@example.test>' });
    await request;
  });
  expect(root!.root.findByType('b').children.join('')).toBe('Research Office');
  expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation).toHaveBeenCalled();
});
it('aborts a pending lookup when its metadata row is removed', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    root = create(<MailSenderRecovery target={target} />);
  });
  let request!: Promise<void>;
  await act(async () => {
    request = root!.root
      .findByType('button')
      .props.onClick({ preventDefault() {}, stopPropagation() {} });
  });
  const signal = vi.mocked(sourceRequest).mock.calls[0]![2] as AbortSignal;
  await act(async () => {
    root!.unmount();
    root = undefined;
  });
  expect(signal.aborted).toBe(true);
  finish({ sender: 'Late sender' });
  await request;
});
