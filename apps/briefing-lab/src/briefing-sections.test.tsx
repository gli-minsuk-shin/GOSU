import { useState, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BriefingRoutine, type SourceKind } from '@gosu/briefing-core';
import { BriefingSections, SectionOrderEditor } from './briefing-sections';
import { initialWorkspace } from './fixtures';
import { runFixture } from './state';
import { collapseBriefingBlocks } from './briefing-collapse-all';

const now = '2026-09-08T00:00:00.000Z';
const workspace = runFixture(initialWorkspace(now), 'personal-research', now, 'run');
const labels: Record<SourceKind, string> = {
  weather: 'Weather',
  email: 'Email',
  papers: 'Papers',
  todo: 'Tasks',
  calendar: 'Calendar',
  'ai-news': 'AI',
  news: 'News',
  conference: 'Conference',
  funding: 'Funding',
};
const renderers: ReactTestRenderer[] = [];
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => {
  await act(() => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
  });
  vi.unstubAllGlobals();
});
async function mount(node: ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(() => {
    renderer = create(node);
  });
  renderers.push(renderer);
  return renderer;
}
describe('Grouped briefing overview', () => {
  it('keeps controlled groups collapsed after the global action and a later rerender, but allows reopening', async () => {
    const props = { run: workspace.runs[0]!, labels, renderItem: () => null };
    const renderer = await mount(<BriefingSections {...props} />);
    await act(() => renderer.root.findByProps({ 'aria-label': 'Papers 3건 보기' }).props.onClick());
    const group = renderer.root
      .findAllByType('details')
      .find((g) => g.props['data-section-kind'] === 'papers')!;
    expect(group.props.open).toBe(true);
    const block = {
      open: true,
      closest: () => null,
      dispatchEvent: () => {
        group.props.onToggle({ currentTarget: block });
        return true;
      },
    };
    await act(() => {
      collapseBriefingBlocks({
        querySelectorAll: () => [block],
        dispatchEvent: vi.fn(),
        scrollTo: vi.fn(),
      } as unknown as HTMLElement);
    });
    await act(() => renderer.update(<BriefingSections {...props} labels={{ ...labels }} />));
    expect(group.props.open).toBe(false);
    await act(() => renderer.root.findByProps({ 'aria-label': 'Papers 3건 보기' }).props.onClick());
    expect(group.props.open).toBe(true);
  });
  it('starts collapsed with counts and headlines, jumps to a group, and supports expand/collapse all', async () => {
    const run = workspace.runs[0]!;
    const renderer = await mount(
      <BriefingSections
        run={run}
        order={['papers', 'email']}
        labels={labels}
        renderItem={({ evidence }) => <article key={evidence.id}>{evidence.title}</article>}
      />,
    );
    const groups = () => renderer.root.findAllByType('details');
    expect(groups().map((node) => node.props['data-section-kind'])).toEqual([
      'papers',
      'email',
      'todo',
      'calendar',
    ]);
    expect(groups().every((node) => !node.props.open)).toBe(true);
    const papers = renderer.root.findByProps({ 'aria-label': 'Papers 3건 보기' });
    await act(() => papers.props.onClick());
    expect(groups()[0]!.props.open).toBe(true);
    expect(groups()[1]!.props.open).toBe(false);
    await act(() =>
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.join('') === '모두 펼치기')!
        .props.onClick(),
    );
    expect(groups().every((node) => node.props.open)).toBe(true);
    await act(() =>
      renderer.root
        .findAllByType('button')
        .find((button) => button.children.join('') === '모두 접기')!
        .props.onClick(),
    );
    expect(groups().every((node) => !node.props.open)).toBe(true);
  });
  it('does not leak hidden titles into preview headlines or counts', async () => {
    const run = workspace.runs[0]!;
    const emails = run.items
      .filter((item) => item.evidence.kind === 'email')
      .map((item) => item.evidence.id);
    const renderer = await mount(
      <BriefingSections
        run={{ ...run, hiddenItemIds: emails }}
        labels={labels}
        renderItem={({ evidence }) => <article key={evidence.id}>{evidence.title}</article>}
      />,
    );
    expect(renderer.root.findByProps({ 'aria-label': 'Email 0건 보기' })).toBeTruthy();
    expect(JSON.stringify(renderer.toJSON())).not.toContain('연구 미팅 전 검토 요청');
    expect(JSON.stringify(renderer.toJSON())).toContain('카드를 모두 숨겼습니다');
  });
});
describe('Section ordering editor', () => {
  it('moves through buttons and drag/drop, keeps inactive categories, and ignores foreign drag data', async () => {
    let current = workspace.routines[0]!;
    const edits = vi.fn();
    function Harness() {
      const [routine, setRoutine] = useState<BriefingRoutine>(current);
      return (
        <SectionOrderEditor
          routine={routine}
          labels={labels}
          onChange={(sectionOrder) => {
            current = { ...routine, sectionOrder };
            edits(sectionOrder);
            setRoutine(current);
          }}
        />
      );
    }
    const renderer = await mount(<Harness />);
    await act(() =>
      renderer.root.findByProps({ 'aria-label': 'Papers 섹션 위로' }).props.onClick(),
    );
    expect(current.sectionOrder?.slice(0, 3)).toEqual(['weather', 'papers', 'email']);
    await act(() =>
      renderer.root.findByProps({ 'aria-label': 'Papers 섹션 아래로' }).props.onClick(),
    );
    expect(current.sectionOrder?.slice(0, 3)).toEqual(['weather', 'email', 'papers']);
    const target = renderer.root.findByProps({ 'data-section-kind': 'weather' });
    await act(() =>
      target.props.onDrop({ preventDefault: vi.fn(), dataTransfer: { getData: () => 'papers' } }),
    );
    expect(current.sectionOrder?.slice(0, 3)).toEqual(['papers', 'weather', 'email']);
    const count = edits.mock.calls.length;
    await act(() =>
      target.props.onDrop({
        preventDefault: vi.fn(),
        dataTransfer: { getData: () => 'external-file' },
      }),
    );
    expect(edits).toHaveBeenCalledTimes(count);
    expect(current.sources).toEqual(workspace.routines[0]!.sources);
  });
  it('keeps funding order independent from personal briefing kinds', async () => {
    const renderer = await mount(
      <SectionOrderEditor routine={workspace.routines[1]!} labels={labels} onChange={vi.fn()} />,
    );
    expect(renderer.root.findAllByType('li')).toHaveLength(1);
    expect(renderer.root.findByProps({ 'aria-label': 'Funding 섹션 위로' }).props.disabled).toBe(
      true,
    );
  });
});
