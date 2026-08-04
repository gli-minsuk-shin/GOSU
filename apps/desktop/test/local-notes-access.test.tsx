import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  LocalNotesProjectAccess,
  LocalNotesView,
  type VaultRuntimeState,
} from '../src/renderer/src/notes-view';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';
import type { ProjectChatProfile } from '../src/shared/project-chat-contracts';
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

function renderLocalNotes(
  options: {
    activeProject?: ProjectRecord | undefined;
    activeVault?: VaultSelection | null;
    vaultState?: VaultRuntimeState;
    profile?: ProjectChatProfile | undefined;
    profileLoading?: boolean;
    accessBusy?: boolean;
  } = {},
) {
  const activeProject = Object.hasOwn(options, 'activeProject') ? options.activeProject : project;
  const activeVault = Object.hasOwn(options, 'activeVault') ? options.activeVault : vault;
  const profile = Object.hasOwn(options, 'profile')
    ? options.profile
    : defaultProjectChatProfile(project.id);
  const vaultState = options.vaultState ?? 'ready';
  const profileLoading = options.profileLoading ?? false;
  const accessBusy = options.accessBusy ?? false;

  return renderToStaticMarkup(
    <LocalNotesView
      vault={activeVault}
      vaultState={vaultState}
      selectedNote={null}
      busy={false}
      project={activeProject}
      profile={profile}
      profileLoading={profileLoading}
      accessBusy={accessBusy}
      onChoose={vi.fn()}
      onRead={vi.fn()}
      onSetProjectAccess={vi.fn()}
      onOpenAgentSettings={vi.fn()}
    />,
  );
}

describe('Local Notes project-agent access', () => {
  it('sends the exact current grant and opens the provided Agent Settings route', () => {
    const onSetAccess = vi.fn();
    const onOpenSettings = vi.fn();
    const access = LocalNotesProjectAccess({
      vault,
      vaultState: 'ready',
      project,
      profile: defaultProjectChatProfile(project.id),
      profileLoading: false,
      busy: false,
      onSetAccess,
      onOpenSettings,
    });

    findButton(access, 'Authorize for Active study').props.onClick?.();
    findButton(access, 'Open AI Agent Settings…').props.onClick?.();

    expect(onSetAccess).toHaveBeenCalledWith({ id: vault.id, name: vault.name });
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('wires the visible revoke action to an explicit null grant', () => {
    const onSetAccess = vi.fn();
    const access = LocalNotesProjectAccess({
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
    const html = renderLocalNotes();

    expect(html).toContain('Not authorized for Active study');
    expect(html).toContain('Research Vault remains local-only');
    expect(html).toContain('Authorize for Active study');
    expect(html).toContain('Open AI Agent Settings…');
    expect(html).not.toContain('Revoke access');
    expect(html).toMatch(
      /<button type="button" class="secondary-button">Authorize for Active study<\/button>/u,
    );
  });

  it('recognizes only a matching folder grant and offers an explicit revoke action', () => {
    const html = renderLocalNotes({
      profile: {
        ...defaultProjectChatProfile(project.id),
        localNotesVault: { id: vault.id, name: vault.name },
      },
    });

    expect(html).toContain('Authorized for Active study');
    expect(html).toContain('can be listed and read through bounded tools');
    expect(html).toContain('Revoke access');
    expect(html).toContain('Open AI Agent Settings…');
    expect(html).not.toContain('Authorize for Active study');
  });

  it('does not silently transfer a stale grant to the currently selected folder', () => {
    const html = renderLocalNotes({
      profile: {
        ...defaultProjectChatProfile(project.id),
        localNotesVault: { id: 'b'.repeat(64), name: 'Previous Vault' },
      },
    });

    expect(html).toContain('Current folder not authorized for Active study');
    expect(html).toContain(
      'Previous Vault was authorized previously. Access never transfers silently to Research Vault.',
    );
    expect(html).toContain('Authorize for Active study');
    expect(html).toContain('Revoke access');
    expect(html).not.toContain('>Authorized for Active study<');
  });

  it.each([
    {
      name: 'folder verification is still checking',
      props: { vaultState: 'checking' as const },
      title: 'Checking the Local Notes folder…',
    },
    {
      name: 'folder capability is unavailable',
      props: { vaultState: 'unavailable' as const },
      title: 'Folder unavailable',
    },
    {
      name: 'the encrypted project profile is unavailable',
      props: { profile: undefined },
      title: 'Project access status unavailable',
    },
  ])('fails closed when $name', ({ props, title }) => {
    const html = renderLocalNotes(props);

    expect(html).toContain(title);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Authorize for Active study<\/button>/u);
    expect(html).toContain('Open AI Agent Settings…');
    expect(html).not.toContain('>Authorized for Active study<');
  });

  it('fails closed without an active project and does not show a misleading settings action', () => {
    const html = renderLocalNotes({ activeProject: undefined });

    expect(html).toContain('Select an active project');
    expect(html).toContain('Choose a project in the sidebar before granting its agent access.');
    expect(html).not.toContain('Authorize for');
    expect(html).not.toContain('Revoke access');
    expect(html).not.toContain('Open AI Agent Settings…');
  });

  it('keeps authorization paused while a matching saved grant is being checked', () => {
    const html = renderLocalNotes({
      vaultState: 'checking',
      profile: {
        ...defaultProjectChatProfile(project.id),
        localNotesVault: { id: vault.id, name: vault.name },
      },
    });

    expect(html).toContain('Checking the Local Notes folder…');
    expect(html).toContain('Revoke access');
    expect(html).not.toContain('>Authorized for Active study<');
  });
});
