import { createRoot } from 'react-dom/client';
import type { CSSProperties } from 'react';

import '../../src/renderer/src/styles.css';
import { ManuscriptView } from '../../src/renderer/src/manuscript-view';
import type { ManuscriptWorkspaceSnapshot } from '../../src/shared/manuscript-workspace-contracts';
import type { ProjectRecord } from '../../src/shared/workspace-contracts';

type FixtureState = 'unlinked' | 'connected' | 'error';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const MANUSCRIPT_ID = '22222222-2222-4222-8222-222222222222';
const BINDING_ID = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-08-11T00:00:00.000Z';

const project: ProjectRecord = {
  id: PROJECT_ID,
  name: 'Long manuscript collaboration project for minimum-window geometry',
  slug: 'long-manuscript-collaboration-project',
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const descriptor = {
  schemaVersion: 1 as const,
  providerId: 'overleaf_git',
  displayName: 'Overleaf Git checkpoint workspace',
  workspaceKind: 'remote_git_checkpoint' as const,
  collaborationModel: 'checkpoint' as const,
  capabilities: {
    schemaVersion: 1 as const,
    interactionModes: ['checkpoint_pull' as const, 'external_realtime_editor' as const],
    revisionTopology: 'linear' as const,
    conditionalPublish: false,
    providerHistory: true,
    presence: false,
    comments: false,
    trackChanges: false,
    serverCompile: false,
    reviewMetadataRoundTrip: 'unsupported' as const,
  },
  unsupportedMetadata: ['comments', 'track_changes'],
  limitations: ['manual_checkpoint_only'],
};

const manuscript = {
  schemaVersion: 1 as const,
  id: MANUSCRIPT_ID,
  projectId: PROJECT_ID,
  title:
    'Main manuscript with a deliberately long descriptive title for responsive layout coverage',
  rootDocument: 'paper/sections/reproducible-study-and-supplement/main.tex',
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

function snapshotFor(state: Exclude<FixtureState, 'error'>): ManuscriptWorkspaceSnapshot {
  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    providers: [descriptor],
    manuscripts: [
      {
        manuscript,
        connection:
          state === 'unlinked'
            ? null
            : {
                binding: {
                  schemaVersion: 1,
                  bindingId: BINDING_ID,
                  projectId: PROJECT_ID,
                  manuscriptId: MANUSCRIPT_ID,
                  providerId: 'overleaf_git',
                  capabilitiesSnapshot: descriptor.capabilities,
                  authority: 'gosu',
                  enabled: true,
                  version: 1,
                  createdAt: NOW,
                  updatedAt: NOW,
                },
                providerDisplayName: descriptor.displayName,
                workspaceUrl: 'https://www.overleaf.com/project/0123456789abcdef01234567',
                lifecycle: 'blocked',
                syncState: 'provider_ahead',
                anchor: {
                  schemaVersion: 1,
                  bindingId: BINDING_ID,
                  generation: 0,
                  lastCommonRevision: null,
                  providerRevision: null,
                  gosuRevision: 'b'.repeat(40),
                  updatedAt: NOW,
                },
                lastObservedProviderRevision: 'a'.repeat(40),
                lastObservedAt: NOW,
                lastFailureCode: 'overleaf_git_root_document_missing',
                lastCheckpoint: null,
              },
      },
    ],
  };
}

const searchState = new URLSearchParams(window.location.search).get('state');
const fixtureState: FixtureState =
  searchState === 'connected' || searchState === 'error' ? searchState : 'unlinked';

const manuscriptWorkspace = {
  list: async () => {
    if (fixtureState === 'error') throw new Error('manuscript_provider_unavailable');
    return snapshotFor(fixtureState);
  },
  create: async () => snapshotFor('unlinked'),
  update: async () => snapshotFor(fixtureState),
  connectOverleafGit: async () => snapshotFor('connected'),
  inspect: async () => snapshotFor('connected'),
  fetchCheckpoint: async () => snapshotFor('connected'),
  disconnect: async () => snapshotFor('unlinked'),
};

Object.defineProperty(window, 'gosu', {
  configurable: true,
  value: {
    manuscriptWorkspace,
    openExternal: async () => true,
  },
});

function Fixture() {
  return (
    <main
      className="desktop-shell"
      style={{ '--project-sidebar-width': '440px' } as CSSProperties}
      data-fixture-state={fixtureState}
    >
      <header className="titlebar">
        <span className="logo">G</span>
        <strong>GOSU</strong>
        <span>Manuscript minimum-window geometry fixture</span>
      </header>
      <aside className="desktop-nav" aria-label="Projects">
        <small>Projects</small>
        <div className="project-switcher">
          <strong>440 px project sidebar fixture</strong>
        </div>
      </aside>
      <section className="desktop-content" aria-label="Manuscript content">
        <ManuscriptView project={project} />
      </section>
    </main>
  );
}

const root = document.querySelector('#root');
if (!root) throw new Error('missing_manuscript_layout_smoke_root');
createRoot(root).render(<Fixture />);
