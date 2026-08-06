import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  projectChatSessionRenameKeyAction,
  ProjectChatSessionRail,
  validateProjectChatSessionRename,
} from '../src/renderer/src/project-chat-session-rail';

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
        onRename={() => true}
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
    expect(html).toContain('aria-label="Rename selected project chat session"');
    expect(html).toContain('aria-label="Rename Project chat"');
    expect(html).toContain('aria-label="Rename Ablation ideas"');
    expect(html).toContain('aria-label="Hide project chat sessions"');
    expect(html).toContain('aria-expanded="true"');
  });

  it('keeps only an accessible restore control and selected-session summary when minimized', () => {
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
        ]}
        selectedSessionId={defaultSession.id}
        activeSessionIds={new Set([defaultSession.id])}
        creating={false}
        disabled
        renameDisabled
        collapsed
        onSelect={() => undefined}
        onCreate={() => undefined}
        onRename={() => true}
      />,
    );

    expect(html).toContain('project-chat-session-rail collapsed');
    expect(html).toContain('aria-label="Show project chat sessions"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Selected session: Project chat');
    expect(html).toContain('class="project-chat-session-list" hidden=""');
    expect(html).not.toContain('Ablation ideas');
    expect(html).not.toContain('Create a new project chat session');
    expect(html).not.toContain('Rename selected project chat session');
    expect(html).not.toContain('Resize project chat sessions sidebar');
    expect(html).toMatch(
      /<button[^>]*aria-label="Show project chat sessions"(?![^>]*disabled)[^>]*>/u,
    );
  });

  it('validates trimmed session names without hard-coding a visible model flow', () => {
    expect(validateProjectChatSessionRename('  Better title  ', 'Project chat')).toEqual({
      status: 'valid',
      title: 'Better title',
    });
    expect(validateProjectChatSessionRename('  Project chat ', 'Project chat')).toEqual({
      status: 'unchanged',
      title: 'Project chat',
    });
    expect(validateProjectChatSessionRename('   ', 'Project chat')).toEqual({
      status: 'invalid',
      message: 'Enter a session name.',
    });
    expect(validateProjectChatSessionRename('a'.repeat(120), 'Project chat')).toMatchObject({
      status: 'valid',
    });
    expect(validateProjectChatSessionRename('a'.repeat(121), 'Project chat')).toEqual({
      status: 'invalid',
      message: 'Session names can contain at most 120 characters.',
    });
  });

  it('maps Enter and Escape while leaving IME composition alone', () => {
    expect(
      projectChatSessionRenameKeyAction({ key: 'Enter', isComposing: false, keyCode: 13 }),
    ).toBe('save');
    expect(
      projectChatSessionRenameKeyAction({ key: 'Escape', isComposing: false, keyCode: 27 }),
    ).toBe('cancel');
    expect(
      projectChatSessionRenameKeyAction({ key: 'Enter', isComposing: true, keyCode: 13 }),
    ).toBeNull();
    expect(
      projectChatSessionRenameKeyAction({ key: 'Enter', isComposing: false, keyCode: 229 }),
    ).toBeNull();
  });

  it('uses the persisted rail width variable and removes the horizontal handle on narrow layouts', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /\.project-chat-workspace\s*\{[^}]*--project-chat-session-rail-active-width:\s*var\(--project-chat-session-rail-width, 184px\);[^}]*grid-template-columns:\s*var\(--project-chat-session-rail-active-width\) minmax\(0, 1fr\);/su,
    );
    expect(styles).toMatch(
      /\.project-chat-workspace\.session-rail-collapsed\s*\{[^}]*--project-chat-session-rail-active-width:\s*44px;/su,
    );
    expect(styles).toMatch(
      /\.project-chat-session-resize-handle\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0;/su,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.project-chat-session-resize-handle\s*\{\s*display:\s*none;/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.project-chat-session-row\s*\{[^}]*flex:\s*0 0 214px;/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.project-chat-workspace\.session-rail-collapsed\s*\{[^}]*grid-template:\s*44px minmax\(0, 1fr\) \/ 1fr;/u,
    );
    expect(styles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.project-chat-session-rail\.collapsed\s*\{[^}]*min-height:\s*44px;[^}]*height:\s*44px;/u,
    );
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.project-chat-workspace,[\s\S]*?transition:\s*none;/u,
    );
    expect(styles).toMatch(
      /\.project-chat-session-row\.active \.project-chat-session-rename-trigger\s*\{[^}]*opacity:\s*1;/su,
    );
    expect(styles).toMatch(/\.project-chat-session-rename-form\s*\{[^}]*grid-column:\s*1 \/ -1;/su);
  });

  it('uses the inline rename flow instead of a system prompt', () => {
    const desktopApp = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );

    expect(desktopApp).not.toContain("window.prompt('Rename chat session'");
    expect(desktopApp).toContain('onRenameSession={renameChatSession}');
  });
});
