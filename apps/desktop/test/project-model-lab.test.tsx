import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isProjectModelLabLocation,
  OpenProjectModelLabSchema,
} from '../src/shared/model-lab-contracts';
import { projectModelLabSessionIds } from '../src/renderer/src/project-model-lab-view';
import {
  WORKSPACE_TABS,
  shouldShowActiveProjectPageHeading,
} from '../src/renderer/src/workspace-views';
import { desktopContentClassName } from '../src/renderer/src/desktop-content-layout';
import { createTrustedRenderer, rendererContentSecurityPolicy } from '../src/main/renderer-trust';

const id = '11111111-1111-4111-8111-111111111111';
describe('GOSU project Model Lab integration', () => {
  it('stacks workspace warnings above the full-width embedded session instead of squeezing it sideways', () => {
    const css = readFileSync(
      new URL('../src/renderer/src/project-model-lab-view.css', import.meta.url),
      'utf8',
    );
    expect(css).toMatch(
      /\.desktop-content\.desktop-content-model-lab\s*\{[^}]*flex-direction:\s*column;/s,
    );
    expect(css).toMatch(/\.project-model-lab-workspaces\s*\{[^}]*order:\s*1;/s);
  });
  it('places Model Lab directly under Project chat with a full-height content panel', () => {
    expect(WORKSPACE_TABS.slice(0, 2).map((tab) => tab.id)).toEqual(['chat', 'model-lab']);
    expect(shouldShowActiveProjectPageHeading('model-lab')).toBe(false);
    expect(
      desktopContentClassName({ surface: 'workspace', tab: 'model-lab', hasActiveProject: true }),
    ).toBe('desktop-content desktop-content-model-lab');
  });
  it('requires the exact project capability location from the main-process bridge', () => {
    const url = `http://127.0.0.1:49391/s/${'a'.repeat(64)}/${id}/`;
    expect(isProjectModelLabLocation({ projectId: id, url }, id)).toBe(true);
    expect(
      isProjectModelLabLocation(
        { projectId: id, url: url.replace('127.0.0.1', 'example.com') },
        id,
      ),
    ).toBe(false);
    expect(isProjectModelLabLocation({ projectId: id, url: `${url}?redirect=evil` }, id)).toBe(
      false,
    );
    expect(isProjectModelLabLocation({ projectId: 'other', url }, id)).toBe(false);
    expect(OpenProjectModelLabSchema.safeParse({ projectId: '../escape' }).success).toBe(false);
  });
  it('keeps one live session per visited project and evicts removed projects', () => {
    expect(projectModelLabSessionIds(['a'], ['a', 'b'], 'b')).toEqual(['a', 'b']);
    expect(projectModelLabSessionIds(['a', 'b'], ['a', 'b'], null)).toEqual(['a', 'b']);
    expect(projectModelLabSessionIds(['a', 'b'], ['b'], 'b')).toEqual(['b']);
  });
  it('allows only the exact private host origin in the packaged frame CSP', () => {
    const trusted = createTrustedRenderer({
      isPackaged: true,
      developmentUrl: undefined,
      productionEntryPath: '/tmp/index.html',
    });
    const csp = rendererContentSecurityPolicy(trusted, 'http://127.0.0.1:49391');
    expect(csp).toContain('frame-src http://127.0.0.1:49391;');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('127.0.0.1:*');
    expect(() => rendererContentSecurityPolicy(trusted, 'https://example.com')).toThrow();
  });
});
