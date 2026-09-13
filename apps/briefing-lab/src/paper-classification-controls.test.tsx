import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  PaperClassificationActions,
  PaperClassificationControl,
} from './paper-classification-controls';
import type { SavedPaper } from './paper-library-index';
import { sourceRequest } from './live-client';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer;
const paper = (n = 0): SavedPaper => ({
  historyId: `h${n}`,
  savedAt: '2026-09-10T00:00:00Z',
  classificationKey: n.toString(16).padStart(64, 'a'),
  item: {
    id: `p${n}`,
    title: `Paper ${n}`,
    summary: 'Stored summary',
    readScope: 'abstract',
    importance: 'medium',
    relevance: '',
  },
});
const classification = {
  taxonomyVersion: 1 as const,
  source: 'user' as const,
  categoryId: 'learning' as const,
  reason: 'User edit',
  revision: 1,
  classifiedAt: '2026-09-10T00:00:00Z',
  summaryDigest: 'b'.repeat(64),
};
afterEach(async () => {
  await act(() => ui?.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('does no inference on rendering and batches up to six, never including user-pinned categories', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const papers = Array.from({ length: 14 }, (_, n) => paper(n));
  papers[0]!.item.classification = classification;
  const onChanged = vi.fn(async () => undefined);
  vi.mocked(sourceRequest).mockImplementation(async (_path, raw) => ({
    saved: (raw as { targets: { key: string }[] }).targets.map((t) => t.key),
    skipped: 0,
  }));
  await act(() => {
    ui = create(<PaperClassificationActions routineId="r" papers={papers} onChanged={onChanged} />);
  });
  expect(sourceRequest).not.toHaveBeenCalled();
  await act(() => ui.root.findAllByType('button')[0]!.props.onClick());
  expect(sourceRequest).toHaveBeenCalledTimes(3);
  const requests = vi
    .mocked(sourceRequest)
    .mock.calls.map(([, raw]) => raw as { routineId: string; targets: { key: string }[] });
  expect(requests.map((r) => r.targets.length)).toEqual([6, 6, 1]);
  expect(requests.flatMap((r) => r.targets.map((t) => t.key))).not.toContain(
    papers[0]!.classificationKey,
  );
  expect(onChanged).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(ui.toJSON())).toContain('13편 분류 저장됨');
});
it('edits from the fixed taxonomy with revision checks and confirms storage before hiding the editor', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const p = paper();
  p.item.classification = { ...classification, source: 'ai' };
  const onChanged = vi.fn(async () => undefined);
  vi.mocked(sourceRequest).mockResolvedValue({ saved: [p.classificationKey], skipped: 0 });
  await act(() => {
    ui = create(<PaperClassificationControl routineId="r" paper={p} onChanged={onChanged} />);
  });
  expect(ui.root.findAllByType('select')).toHaveLength(0);
  await act(() => ui.root.findByProps({ 'aria-label': 'Paper 0 분류 수정' }).props.onClick());
  expect(ui.root.findByType('select').findAllByType('option')).toHaveLength(10);
  await act(() => ui.root.findByType('select').props.onChange({ target: { value: 'statistics' } }));
  await act(() =>
    ui.root
      .findAllByType('button')
      .find((b) => b.children.includes('분류 저장'))!
      .props.onClick(),
  );
  expect(sourceRequest).toHaveBeenCalledWith(
    '/papers/classification/edit',
    {
      routineId: 'r',
      target: { key: p.classificationKey, expectedRevision: 1 },
      categoryId: 'statistics',
    },
    expect.any(AbortSignal),
  );
  expect(onChanged).toHaveBeenCalledOnce();
  expect(ui.root.findAllByType('select')).toHaveLength(0);
});
it('keeps the editor and old classification visible when saving fails', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockRejectedValue(new Error('분류가 변경됐습니다.'));
  const onChanged = vi.fn(async () => undefined);
  await act(() => {
    ui = create(<PaperClassificationControl routineId="r" paper={paper()} onChanged={onChanged} />);
  });
  await act(() => ui.root.findByProps({ 'aria-label': 'Paper 0 분류 수정' }).props.onClick());
  await act(() =>
    ui.root
      .findAllByType('button')
      .find((b) => b.children.includes('분류 저장'))!
      .props.onClick(),
  );
  expect(ui.root.findAllByType('select')).toHaveLength(1);
  expect(JSON.stringify(ui.toJSON())).toContain('분류가 변경됐습니다.');
  expect(onChanged).not.toHaveBeenCalled();
});
it('cancels the running classification when leaving the routine', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let requestSignal: AbortSignal | undefined;
  vi.mocked(sourceRequest).mockImplementation(async (_path, _raw, signal) => {
    requestSignal = signal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
    );
  });
  await act(() => {
    ui = create(
      <PaperClassificationActions
        routineId="r"
        papers={[paper()]}
        onChanged={async () => undefined}
      />,
    );
  });
  await act(() => ui.root.findAllByType('button')[0]!.props.onClick());
  expect(requestSignal?.aborted).toBe(false);
  await act(() => ui.unmount());
  expect(requestSignal?.aborted).toBe(true);
});
