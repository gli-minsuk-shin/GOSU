import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  shouldShowActiveProjectPageHeading,
  WorkspacePageHeading,
} from '../src/renderer/src/workspace-views';

describe('workspace page heading', () => {
  it('keeps the descriptive Project Chat heading available for empty-project states', () => {
    const html = renderToStaticMarkup(
      <WorkspacePageHeading activeTab="chat" activeProject={undefined} onNewProject={null} />,
    );

    expect(html).toContain('class="page-heading page-heading-chat"');
    expect(html).toContain('Project chat');
  });

  it('gives an active Project Chat the full content area without the shared heading', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(shouldShowActiveProjectPageHeading('chat')).toBe(false);
    expect(styles).toMatch(
      /\.project-chat-workspace\s*\{[^}]*height:\s*max\(560px, calc\(100vh - 92px\)\);/su,
    );
    expect(styles).toMatch(
      /@media \(max-width: 860px\)[\s\S]*?\.project-chat-workspace\s*\{[^}]*height:\s*calc\(100vh - 140px\);/u,
    );
  });

  it('gives active Research Notes the compact document area without the shared heading', () => {
    const html = renderToStaticMarkup(
      <WorkspacePageHeading activeTab="notes" activeProject={undefined} onNewProject={null} />,
    );

    expect(html).toContain('class="page-heading page-heading-notes"');
    expect(html).toContain('Research Notes');
    expect(shouldShowActiveProjectPageHeading('notes')).toBe(false);
  });

  it('keeps the Manuscript explanation for empty projects while its active view owns the compact heading', () => {
    const html = renderToStaticMarkup(
      <WorkspacePageHeading activeTab="manuscript" activeProject={undefined} onNewProject={null} />,
    );

    expect(html).toContain('page-heading-manuscript');
    expect(html).toContain('Manuscript');
    expect(html).toContain('replaceable writing engines');
    expect(shouldShowActiveProjectPageHeading('manuscript')).toBe(false);
  });

  it('keeps other workspace headings on their own surface class', () => {
    const html = renderToStaticMarkup(
      <WorkspacePageHeading
        activeTab="board"
        activeProject={undefined}
        onNewProject={() => undefined}
      />,
    );

    expect(html).toContain('class="page-heading page-heading-board"');
    expect(html).not.toContain('page-heading-chat');
    expect(html).toContain('New project');
    expect(shouldShowActiveProjectPageHeading('board')).toBe(true);
  });

  it('keeps the Literature description available while active projects use the compact workspace', () => {
    const html = renderToStaticMarkup(
      <WorkspacePageHeading activeTab="literature" activeProject={undefined} onNewProject={null} />,
    );

    expect(html).toContain('page-heading-literature');
    expect(html).toContain('Literature');
    expect(html).toContain('living evidence table');
    expect(html).toContain('JSON, CSV, and BibTeX');
    expect(shouldShowActiveProjectPageHeading('literature')).toBe(false);
  });

  it('lets the workspace-level Lecture Studio own its compact heading', () => {
    const html = renderToStaticMarkup(
      <WorkspacePageHeading activeTab="lecture" activeProject={undefined} onNewProject={null} />,
    );

    expect(html).toContain('page-heading-lecture');
    expect(html).toContain('Lecture notes &amp; slides');
    expect(html).toContain('across projects');
    expect(shouldShowActiveProjectPageHeading('lecture')).toBe(false);
  });
});
