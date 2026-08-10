import { readFileSync } from 'node:fs';

import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ResearchNotesProjectAccess,
  ResearchNotesView,
  researchNotesAttentionMessage,
  type VaultRuntimeState,
} from '../src/renderer/src/notes-view';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';
import type { ProjectChatProfile } from '../src/shared/project-chat-contracts';
import type { ResearchNotesWorkspace } from '../src/shared/research-notes-contracts';
import type { VaultSelection } from '../src/shared/vault-contracts';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const project: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Active study',
  slug: 'active-study',
  version: 2,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const vault: VaultSelection = {
  id: 'a'.repeat(64),
  name: 'Research Vault',
  root: '/fixture/research-vault',
  files: ['index.md'],
};

const workspace: ResearchNotesWorkspace = {
  schemaVersion: 1,
  projectId: project.id,
  projectName: project.name,
  bindingId: vault.id,
  vaultId: 'c'.repeat(64),
  vaultName: 'Research Vault',
  displayRoot: 'Research Vault/GOSU/Active study',
  files: ['Literature/Literature Review.md', 'Papers/Papers Index.md'],
  folders: ['Literature', 'Papers', 'Experiments', 'Project Progress', 'Idea Development'],
  status: 'ready',
  attentionCode: null,
  lastLiteratureSyncAt: '2026-08-06T00:00:00.000Z',
};

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<{ children?: ReactNode }>(node)) return '';
  return Children.toArray(node.props.children).map(nodeText).join('');
}

function findButton(node: ReactNode, label: string): ReactElement<{ onClick?: () => void }> {
  let match: ReactElement<{ onClick?: () => void }> | undefined;
  const visit = (candidate: ReactNode) => {
    if (match || !isValidElement<{ children?: ReactNode; onClick?: () => void }>(candidate)) return;
    if (candidate.type === 'button' && nodeText(candidate).includes(label)) {
      match = candidate;
      return;
    }
    Children.forEach(candidate.props.children, visit);
  };
  visit(node);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

function renderResearchNotes(
  options: {
    activeProject?: ProjectRecord | undefined;
    activeWorkspace?: ResearchNotesWorkspace | null;
    vaultState?: VaultRuntimeState;
    profile?: ProjectChatProfile | undefined;
    profileLoading?: boolean;
    accessBusy?: boolean;
    folderTreeCollapsed?: boolean;
    noteBusy?: boolean;
  } = {},
) {
  const activeProject = Object.hasOwn(options, 'activeProject') ? options.activeProject : project;
  const activeWorkspace = Object.hasOwn(options, 'activeWorkspace')
    ? options.activeWorkspace
    : workspace;
  const profile = Object.hasOwn(options, 'profile')
    ? options.profile
    : defaultProjectChatProfile(project.id);
  const vaultState = options.vaultState ?? 'ready';
  const profileLoading = options.profileLoading ?? false;
  const accessBusy = options.accessBusy ?? false;
  const folderTreeCollapsed = options.folderTreeCollapsed ?? false;
  const noteBusy = options.noteBusy ?? false;

  return renderToStaticMarkup(
    <ResearchNotesView
      workspace={activeWorkspace}
      vaultState={vaultState}
      selectedNote={null}
      busy={noteBusy}
      project={activeProject}
      profile={profile}
      profileLoading={profileLoading}
      accessBusy={accessBusy}
      onChoose={vi.fn()}
      onRead={vi.fn()}
      onSetProjectAccess={vi.fn()}
      onOpenAgentSettings={vi.fn()}
      onRetry={vi.fn()}
      folderTreeCollapsed={folderTreeCollapsed}
      onFolderTreeCollapsedChange={vi.fn()}
    />,
  );
}

describe('Research Notes project-agent access', () => {
  it('sends the exact current grant and opens the provided Agent Settings route', () => {
    const onSetAccess = vi.fn();
    const onOpenSettings = vi.fn();
    const access = ResearchNotesProjectAccess({
      vault,
      vaultState: 'ready',
      project,
      profile: defaultProjectChatProfile(project.id),
      profileLoading: false,
      busy: false,
      onSetAccess,
      onOpenSettings,
    });

    findButton(access, 'Authorize read + automatic saves for Active study').props.onClick?.();
    findButton(access, 'Open AI Agent Settings…').props.onClick?.();

    expect(onSetAccess).toHaveBeenCalledWith({
      id: vault.id,
      name: vault.name,
      allowAgentMarkdownCreate: true,
    });
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('wires the visible revoke action to an explicit null grant', () => {
    const onSetAccess = vi.fn();
    const access = ResearchNotesProjectAccess({
      vault,
      vaultState: 'ready',
      project,
      profile: {
        ...defaultProjectChatProfile(project.id),
        localNotesVault: { id: vault.id, name: vault.name },
      },
      profileLoading: false,
      busy: false,
      onSetAccess,
      onOpenSettings: vi.fn(),
    });

    findButton(access, 'Revoke access').props.onClick?.();

    expect(onSetAccess).toHaveBeenCalledWith(null);
  });

  it('offers direct authorization and an AI Agent Settings shortcut when access is off', () => {
    const html = renderResearchNotes();

    expect(html).toContain('Not authorized for Active study');
    expect(html).toContain('Research Notes remains local-only');
    expect(html).toContain('Authorize read + automatic saves for Active study');
    expect(html).toContain('create reusable deliverables');
    expect(html).toContain('cannot replace a different existing file');
    expect(html).toContain('Open AI Agent Settings…');
    expect(html).not.toContain('Revoke access');
    expect(html).toMatch(
      /<button type="button" class="secondary-button">Authorize read \+ automatic saves for Active study<\/button>/u,
    );
  });

  it('recognizes only a matching folder grant and offers an explicit revoke action', () => {
    const html = renderResearchNotes({
      profile: {
        ...defaultProjectChatProfile(project.id),
        localNotesVault: {
          id: vault.id,
          name: vault.name,
          allowAgentMarkdownCreate: true,
        },
      },
    });

    expect(html).toContain('Read + automatic Markdown saves authorized for Active study');
    expect(html).toContain('create new Markdown files');
    expect(html).toContain('never overwrite an existing note');
    expect(html).toContain('Revoke access');
    expect(html).toContain('Open AI Agent Settings…');
    expect(html).not.toContain('Authorize read + automatic saves for Active study');
  });

  it('keeps a legacy matching grant read-only until automatic saves are explicitly enabled', () => {
    const html = renderResearchNotes({
      profile: {
        ...defaultProjectChatProfile(project.id),
        localNotesVault: { id: vault.id, name: vault.name },
      },
    });

    expect(html).toContain('Read-only access for Active study');
    expect(html).toContain('legacy grant still permits bounded note listing and reading');
    expect(html).toContain('Automatic Markdown saves remain off');
    expect(html).toContain('Enable automatic Markdown saves');
    expect(html).toContain('Revoke access');
  });

  it('does not silently transfer a stale grant to the currently selected folder', () => {
    const html = renderResearchNotes({
      profile: {
        ...defaultProjectChatProfile(project.id),
        localNotesVault: { id: 'b'.repeat(64), name: 'Previous Vault' },
      },
    });

    expect(html).toContain('Current folder not authorized for Active study');
    expect(html).toContain(
      'Previous Vault was authorized previously. Access never transfers silently to another project or Vault.',
    );
    expect(html).toContain('Authorize read + automatic saves for Active study');
    expect(html).toContain('Revoke access');
    expect(html).not.toContain('>Read + automatic Markdown saves authorized for Active study<');
  });

  it.each([
    {
      name: 'folder verification is still checking',
      props: { vaultState: 'checking' as const },
      title: 'Checking the Research Notes folder…',
    },
    {
      name: 'folder capability is unavailable',
      props: { vaultState: 'unavailable' as const },
      title: 'Research Notes unavailable',
    },
    {
      name: 'the encrypted project profile is unavailable',
      props: { profile: undefined },
      title: 'Project access status unavailable',
    },
  ])('fails closed when $name', ({ props, title }) => {
    const html = renderResearchNotes(props);

    expect(html).toContain(title);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Authorize read \+ automatic saves for Active study<\/button>/u,
    );
    expect(html).toContain('Open AI Agent Settings…');
    expect(html).not.toContain('>Read + automatic Markdown saves authorized for Active study<');
  });

  it('fails closed without an active project and does not show a misleading settings action', () => {
    const html = renderResearchNotes({ activeProject: undefined });

    expect(html).toContain('Select an active project');
    expect(html).toContain('Choose a project in the sidebar before granting its agent access.');
    expect(html).not.toContain('Authorize for');
    expect(html).not.toContain('Revoke access');
    expect(html).not.toContain('Open AI Agent Settings…');
  });

  it('keeps authorization paused while a matching saved grant is being checked', () => {
    const html = renderResearchNotes({
      vaultState: 'checking',
      profile: {
        ...defaultProjectChatProfile(project.id),
        localNotesVault: { id: vault.id, name: vault.name },
      },
    });

    expect(html).toContain('Checking the Research Notes folder…');
    expect(html).toContain('Revoke access');
    expect(html).not.toContain('>Read + automatic Markdown saves authorized for Active study<');
  });

  it('shows the project-scoped managed folders and Literature projection status', () => {
    const html = renderResearchNotes();

    expect(html).toContain('Research Vault/GOSU/Active study');
    expect(html).toContain('MANAGED PROJECT FOLDERS');
    for (const folder of workspace.folders) expect(html).toContain(folder);
    expect(html).toContain('Literature table synced');
    expect(html).not.toContain('/fixture/research-vault');
  });

  it('shows the folder tree first and keeps secondary controls closed by default', () => {
    const html = renderResearchNotes();
    const treeIndex = html.indexOf('aria-label="Research Notes files"');
    const toolsIndex = html.indexOf('class="research-notes-sidebar-tools"');
    const managedSummaryIndex = html.indexOf('MANAGED PROJECT FOLDERS');
    const accessIndex = html.indexOf('RESEARCH NOTES AGENT ACCESS');

    expect(treeIndex).toBeGreaterThan(-1);
    expect(toolsIndex).toBeGreaterThan(treeIndex);
    expect(managedSummaryIndex).toBeGreaterThan(toolsIndex);
    expect(accessIndex).toBeGreaterThan(toolsIndex);
    expect(html).toContain('>Search &amp; settings</span>');
    expect(html).toMatch(/<section class="research-notes-sidebar-tools">/u);
    expect(html).toMatch(/class="research-notes-sidebar-tools-toggle"[^>]*aria-expanded="false"/u);
    expect(html).toMatch(/class="research-notes-sidebar-tools-body" hidden=""/u);
    expect(html).not.toContain('class="research-notes-sidebar-tools open"');
    expect(html).toContain('>Change Vault</button>');
    expect(html).toContain('Open AI Agent Settings…');
  });

  it('keeps an open settings panel mounted across a Vault change so picker focus stays visible', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/notes-view.tsx', import.meta.url),
      'utf8',
    );
    const vaultChangeEffect = source.match(
      /useEffect\(\(\) => \{\s*setTreeState\(\{[\s\S]*?\}\);\s*\}, \[vaultId\]\);/u,
    );

    expect(vaultChangeEffect?.[0]).toBeDefined();
    expect(vaultChangeEffect?.[0]).not.toContain('setSidebarToolsOpen(false)');
  });

  it('keeps one accessible folder-tree toggle and the reader visible when expanded', () => {
    const html = renderResearchNotes();

    expect(html).toContain('class="notes-layout"');
    expect(html).toContain('class="note-list"');
    expect(html).toContain('class="ghost-button research-notes-folder-tree-toggle"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Hide Research Notes folder tree"');
    expect(html).toContain('class="collapse-chevron"');
    expect(html).toContain('class="research-notes-tree-details"');
    expect(html).toContain('class="note-reader"');
    expect(html.match(/research-notes-folder-tree-toggle/gu)).toHaveLength(1);
  });

  it('hides only the navigation details and leaves a usable restore control and reader', () => {
    const html = renderResearchNotes({ folderTreeCollapsed: true, noteBusy: true });

    expect(html).toContain('class="notes-layout folder-tree-collapsed"');
    expect(html).toContain('class="note-list collapsed"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show Research Notes folder tree"');
    expect(html).toContain('class="collapse-chevron"');
    expect(html).toMatch(
      /<strong[^>]*hidden=""[^>]*>Research Vault\/GOSU\/Active study<\/strong>/u,
    );
    expect(html).toMatch(/class="research-notes-tree-details" hidden=""/u);
    expect(html).toContain('class="note-reader"');
    expect(html).toContain('Reading…');
    expect(html).not.toMatch(/research-notes-folder-tree-toggle"[^>]*disabled/u);
  });

  it('persists the controlled layout from DesktopApp instead of resetting it per project', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('loadResearchNotesLayoutState(window.localStorage)');
    expect(source).toContain(
      'saveResearchNotesLayoutState(window.localStorage, researchNotesLayout)',
    );
    expect(source).toContain('folderTreeCollapsed={researchNotesLayout.folderTreeCollapsed}');
  });

  it('keeps a project-switch stale note body out of a different project workspace', () => {
    const html = renderToStaticMarkup(
      <ResearchNotesView
        workspace={workspace}
        vaultState="ready"
        selectedNote={{ path: 'Other project/secret.md', content: 'PRIVATE OLD PROJECT BODY' }}
        busy={false}
        project={project}
        profile={defaultProjectChatProfile(project.id)}
        profileLoading={false}
        accessBusy={false}
        onChoose={vi.fn()}
        onRead={vi.fn()}
        onSetProjectAccess={vi.fn()}
        onOpenAgentSettings={vi.fn()}
      />,
    );

    expect(html).not.toContain('PRIVATE OLD PROJECT BODY');
    expect(html).toContain('Select a Markdown file to read it locally.');
  });

  it('explains each fail-closed folder reconciliation reason', () => {
    expect(researchNotesAttentionMessage('folder_name_conflict')).toContain('overwrite');
    expect(researchNotesAttentionMessage('folder_missing')).toContain('missing');
    expect(researchNotesAttentionMessage('folder_ownership_changed')).toContain(
      'ownership marker changed',
    );
    expect(researchNotesAttentionMessage('vault_unavailable')).toContain('Vault is unavailable');
  });

  it('shows a safe retry state while a renamed Obsidian folder has a collision', () => {
    const html = renderResearchNotes({
      activeWorkspace: {
        ...workspace,
        status: 'rename-pending',
        attentionCode: 'folder_name_conflict',
      },
      profile: {
        ...defaultProjectChatProfile(project.id),
        localNotesVault: { id: workspace.bindingId, name: 'Research Notes' },
      },
    });

    expect(html).toContain('would overwrite an existing Obsidian folder');
    expect(html).toContain('>Retry</button>');
    expect(html).toContain('Research Notes grant inactive');
    expect(html.indexOf('would overwrite an existing Obsidian folder')).toBeLessThan(
      html.indexOf('aria-label="Research Notes files"'),
    );
    expect(html).not.toContain('>Read + automatic Markdown saves authorized for Active study<');
  });

  it('distinguishes project-folder verification from first-time Vault connection', () => {
    const checking = renderResearchNotes({
      activeWorkspace: null,
      vaultState: 'checking',
    });
    const unavailable = renderResearchNotes({
      activeWorkspace: null,
      vaultState: 'unavailable',
    });
    const unconnected = renderResearchNotes({ activeWorkspace: null, vaultState: 'ready' });

    expect(checking).toContain('Opening Research Notes…');
    expect(checking).not.toContain('Choose Obsidian Vault</button>');
    expect(unavailable).toContain('Research Notes need attention');
    expect(unavailable).toContain('Retry project folder');
    expect(unconnected).toContain('Connect an Obsidian Vault');
    expect(unconnected).toContain('Choose Obsidian Vault');
  });
});
