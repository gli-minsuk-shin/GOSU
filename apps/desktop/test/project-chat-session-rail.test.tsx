import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProjectChatSessionRail } from '../src/renderer/src/project-chat-session-rail';

const defaultSession = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title: 'Project chat',
  isDefault: true,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

describe('Project Chat session rail', () => {
  it('shows default, independent, and branched sessions together', () => {
    const html = renderToStaticMarkup(
      <ProjectChatSessionRail
        sessions={[
          defaultSession,
          {
            ...defaultSession,
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            title: 'Ablation ideas',
            isDefault: false,
          },
          {
            ...defaultSession,
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            title: 'Branch · Project chat',
            isDefault: false,
            parentSessionId: defaultSession.id,
            branchedFromMessageId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          },
        ]}
        selectedSessionId="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        activeSessionIds={new Set(['cccccccc-cccc-4ccc-8ccc-cccccccccccc'])}
        creating={false}
        onSelect={() => undefined}
        onCreate={() => undefined}
      />,
    );

    expect(html).toContain('Project chat');
    expect(html).toContain('Ablation ideas');
    expect(html).toContain('Branch · Project chat');
    expect(html).toContain('Branched from Project chat');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Turn active');
  });
});
