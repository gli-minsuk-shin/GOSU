import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WorkspacePageHeading } from '../src/renderer/src/workspace-views';

describe('workspace page heading', () => {
  it('marks Project Chat for its compact wide-layout treatment', () => {
    const html = renderToStaticMarkup(
      <WorkspacePageHeading activeTab="chat" activeProject={undefined} onNewProject={null} />,
    );

    expect(html).toContain('class="page-heading page-heading-chat"');
    expect(html).toContain('Project chat');
  });

  it('keeps other workspace headings on their own surface class', () => {
    const html = renderToStaticMarkup(
      <WorkspacePageHeading activeTab="board" activeProject={undefined} onNewProject={null} />,
    );

    expect(html).toContain('class="page-heading page-heading-board"');
    expect(html).not.toContain('page-heading-chat');
  });
});
