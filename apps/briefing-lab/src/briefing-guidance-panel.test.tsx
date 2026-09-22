import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { BriefingGuidanceButton, readBriefingGuidance } from './briefing-guidance-panel';
import { sourceRequest } from './live-client';

vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let ui: ReactTestRenderer;
afterEach(() => {
  act(() => ui?.unmount());
  vi.mocked(sourceRequest).mockReset();
});
const entry = (id: string, text: string) => ({
  id,
  text,
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z',
});
const byLabel = (label: string) => ui.root.findByProps({ 'aria-label': label });
const text = () => JSON.stringify(ui.toJSON());
const type = (node: ReactTestInstance, value: string) =>
  act(() => node.props.onChange({ target: { value }, currentTarget: { value } }));

it('adds, edits and deletes guidance one line at a time and shows the count on the button', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const changed = vi.fn();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { dispatchEvent: changed }));
  vi.mocked(sourceRequest).mockImplementation(async (path: string, body: unknown) => {
    const input = body as { text?: string; id?: string };
    if (path === '/assistant/guidance/list') return { items: [entry('a', '학회 광고는 한 줄로')] };
    if (path === '/assistant/guidance/add')
      return { items: [entry('a', '학회 광고는 한 줄로'), entry('b', input.text!)] };
    if (path === '/assistant/guidance/edit') return { items: [entry('a', input.text!)] };
    if (path === '/assistant/guidance/delete') return { items: [] };
    throw new Error(path);
  });
  await act(async () => {
    ui = create(<BriefingGuidanceButton routineId="r" />);
  });
  const button = byLabel('브리핑 지침 (1개)');
  expect(button.props['aria-expanded']).toBe(false);
  await act(() => button.props.onClick());
  expect(text()).toContain('학회 광고는 한 줄로');

  await type(byLabel('새 브리핑 지침'), 'nrf.re.kr 메일은 반드시 포함');
  await act(async () => byLabel('지침 추가').props.onClick());
  expect(sourceRequest).toHaveBeenCalledWith('/assistant/guidance/add', {
    routineId: 'r',
    text: 'nrf.re.kr 메일은 반드시 포함',
  });
  expect(text()).toContain('nrf.re.kr 메일은 반드시 포함');
  expect(byLabel('새 브리핑 지침').props.value).toBe('');
  // A listed domain is pinned, and the panel says so next to the line.
  expect(text()).toContain('nrf.re.kr 메일 고정');

  await act(() => byLabel('지침 수정: 학회 광고는 한 줄로').props.onClick());
  await type(byLabel('지침 내용 수정'), '학회 광고는 개수만');
  await act(async () => byLabel('수정 저장').props.onClick());
  expect(sourceRequest).toHaveBeenCalledWith('/assistant/guidance/edit', {
    routineId: 'r',
    id: 'a',
    text: '학회 광고는 개수만',
  });
  expect(text()).toContain('학회 광고는 개수만');

  await act(async () => byLabel('지침 삭제: 학회 광고는 개수만').props.onClick());
  expect(sourceRequest).toHaveBeenCalledWith('/assistant/guidance/delete', {
    routineId: 'r',
    id: 'a',
  });
  expect(text()).toContain('아직 지침이 없습니다');
  expect(byLabel('브리핑 지침')).toBeTruthy();
  // Each saved change tells the history view to recompute the pinned mail.
  expect(changed).toHaveBeenCalledTimes(3);
  vi.unstubAllGlobals();
});

it('shows why the list could not be read and reads it again when the panel is reopened', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const unreadable = new Error('브리핑 지침 파일을 읽지 못해 요약을 멈췄습니다.');
  vi.mocked(sourceRequest)
    .mockRejectedValueOnce(unreadable)
    .mockRejectedValueOnce(unreadable)
    .mockResolvedValue({ items: [entry('a', '학회 광고는 한 줄로')] });
  await act(async () => {
    ui = create(<BriefingGuidanceButton routineId="r" />);
  });
  // Opening after the failed first read tries once more; that also fails and says why.
  await act(async () => byLabel('브리핑 지침').props.onClick());
  expect(ui.root.findByProps({ role: 'alert' }).children.join('')).toContain('읽지 못해');
  await act(() => byLabel('브리핑 지침').props.onClick());
  await act(async () => byLabel('브리핑 지침').props.onClick());
  expect(sourceRequest).toHaveBeenCalledTimes(3);
  expect(text()).toContain('학회 광고는 한 줄로');
  expect(ui.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  vi.unstubAllGlobals();
});

it('shows the server reason when a line is rejected and keeps the typed text', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockImplementation(async (path: string) => {
    if (path === '/assistant/guidance/list') return { items: [] };
    throw new Error('브리핑 지침은 최대 20개입니다. 기존 항목을 수정하거나 삭제해주세요.');
  });
  await act(async () => {
    ui = create(<BriefingGuidanceButton routineId="r" />);
  });
  await act(() => byLabel('브리핑 지침').props.onClick());
  await type(byLabel('새 브리핑 지침'), '21번째 지침');
  await act(async () => byLabel('지침 추가').props.onClick());
  expect(ui.root.findByProps({ role: 'alert' }).children.join('')).toContain('최대 20개');
  // The Briefing header hides <p> in its compact layout, so the panel must not use paragraphs.
  expect(ui.root.findAllByType('p')).toHaveLength(0);
  expect(byLabel('새 브리핑 지침').props.value).toBe('21번째 지침');
  vi.unstubAllGlobals();
});

it('shares one guidance read between the header button and the saved briefing view', async () => {
  // Each reading its own copy added requests on top of history, status and chat, and pushed the
  // Briefing Lab server past its three-request limit (routine_busy).
  let finish!: (value: unknown) => void;
  vi.mocked(sourceRequest).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = readBriefingGuidance('r');
  const second = readBriefingGuidance('r');
  expect(sourceRequest).toHaveBeenCalledOnce();
  finish({ items: [entry('a', '학회 광고는 한 줄로')] });
  expect((await first).map((i) => i.id)).toEqual(['a']);
  expect((await second).map((i) => i.id)).toEqual(['a']);
  // A later read asks again, so a saved change is never served from an old answer.
  vi.mocked(sourceRequest).mockResolvedValue({ items: [] });
  expect(await readBriefingGuidance('r')).toEqual([]);
  expect(sourceRequest).toHaveBeenCalledTimes(2);
});
