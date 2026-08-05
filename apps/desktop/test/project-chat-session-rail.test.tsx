import { readFileSync } from 'node:fs';

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
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize project chat sessions sidebar"');
    expect(html).toContain('aria-valuemin="160"');
    expect(html).toContain('aria-valuemax="360"');
  });

  it('uses the persisted rail width variable and removes the horizontal handle on narrow layouts', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /\.project-chat-workspace\s*\{[^}]*grid-template-columns:\s*var\(--project-chat-session-rail-width, 184px\) minmax\(0, 1fr\);/su,
    );
    expect(styles).toMatch(
      /\.project-chat-session-resize-handle\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0;/su,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.project-chat-session-resize-handle\s*\{\s*display:\s*none;/u,
    );
  });
});
