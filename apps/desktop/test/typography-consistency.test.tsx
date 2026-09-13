import { readFileSync, readdirSync } from 'node:fs';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectModelLabView } from '../src/renderer/src/project-model-lab-view';

afterEach(() => vi.unstubAllGlobals());
describe('GOSU shared typography', () => {
  it('keeps connection names separate from longer status labels in narrow sidebars', () => {
    const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
    expect(css).toMatch(
      /\.connection\s*\{[^}]*grid-template-columns:\s*12px minmax\(0, 1fr\) minmax\(0, 1\.2fr\);[^}]*column-gap:\s*6px/s,
    );
    expect(css).toMatch(/\.connection b\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/s);
  });
  it('uses shared tokens instead of independent small-text scales in desktop styles', () => {
    const root = new URL('../src/renderer/src/', import.meta.url);
    const main = readFileSync(new URL('styles.css', root), 'utf8');
    expect(main).toContain("@import '@gosu/ui/typography.css'");
    expect(main).not.toContain('--font-body: calc(14px');
    for (const file of readdirSync(root).filter((name) => name.endsWith('.css'))) {
      const css = readFileSync(new URL(file, root), 'utf8');
      expect(css, file).not.toMatch(
        /font-size:\s*(?:[0-9.]+rem|(?:[0-9]|1[01])px|calc\(var\(--font-caption\) -)/u,
      );
    }
  });
  it('uses the same body size for Project Chat, Literature, and Model Copilot', () => {
    const desktop = readFileSync(
      new URL('../src/renderer/src/styles.css', import.meta.url),
      'utf8',
    );
    const model = readFileSync(new URL('../../model-lab/src/styles.css', import.meta.url), 'utf8');
    expect(model).toContain("@import '@gosu/ui/typography.css'");
    expect(model).toMatch(/\.model-chat-markdown\s*\{[^}]*font-size:\s*var\(--font-body\)/s);
    expect(model).toMatch(
      /\.model-chat__composer-row textarea\s*\{[^}]*font-size:\s*var\(--font-body\)/s,
    );
    expect(desktop).toMatch(/\.chat-composer textarea\s*\{[^}]*font-size:\s*var\(--font-body\)/s);
    // Canvas-owned font ratios stay separate, so UI accessibility settings cannot change math.
    expect(model).toMatch(/\.module-node__formula \.katex\s*\{[^}]*font-size:\s*0\.72rem/s);
  });
  it('updates the existing Model Lab frame on font changes without reopening or reloading it', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const projectId = '11111111-1111-4111-8111-111111111111';
    const url = `http://127.0.0.1:49391/s/${'a'.repeat(64)}/${projectId}/`;
    const open = vi.fn(async () => ({ projectId, url }));
    const postMessage = vi.fn();
    const frame = { contentWindow: { postMessage } };
    vi.stubGlobal('window', { gosu: { modelLab: { open } } });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ProjectModelLabView projectId={projectId} projectName="Research" textSize="compact" />,
        { createNodeMock: (element) => (element.type === 'iframe' ? frame : null) },
      );
    });
    const before = renderer!.root.findByType('iframe');
    expect(before.props.src).toBe(url);
    act(() => before.props.onLoad());
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: 'gosu:ui-typography', version: 1, textSize: 'compact' },
      'http://127.0.0.1:49391',
    );
    await act(async () =>
      renderer!.update(
        <ProjectModelLabView projectId={projectId} projectName="Research" textSize="extra-large" />,
      ),
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findByType('iframe')).toBe(before);
    expect(before.props.src).toBe(url);
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: 'gosu:ui-typography', version: 1, textSize: 'extra-large' },
      'http://127.0.0.1:49391',
    );
    act(() => renderer!.unmount());
  });
});
