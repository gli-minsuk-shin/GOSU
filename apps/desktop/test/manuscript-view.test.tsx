import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ManuscriptWorkspaceConnection,
  ManuscriptWorkspaceSnapshot,
} from '../src/shared/manuscript-workspace-contracts';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const hookState = vi.hoisted(() => ({
  index: 0,
  snapshot: null as ManuscriptWorkspaceSnapshot | null,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: () => undefined,
    useState: <Value,>(initial: Value) => {
      const index = hookState.index++;
      const value = index === 0 ? (hookState.snapshot as Value) : initial;
      return [value, vi.fn()];
    },
  };
});

import { ManuscriptView, validManuscriptRootDocument } from '../src/renderer/src/manuscript-view';
import { deriveManuscriptProviderChange } from '../src/renderer/src/manuscript-provider-change';

const project: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Flexible paper project',
  slug: 'flexible-paper-project',
  version: 1,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

const descriptor = {
  schemaVersion: 1 as const,
  providerId: 'overleaf_git',
  displayName: 'Overleaf Git',
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
  id: '22222222-2222-4222-8222-222222222222',
  projectId: project.id,
  title: 'Main manuscript',
  rootDocument: 'paper/main.tex',
  version: 1,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

const bindingId = '44444444-4444-4444-8444-444444444444';

function connectionFixture(providerRevision = 'a'.repeat(40)): ManuscriptWorkspaceConnection {
  return {
    binding: {
      schemaVersion: 1,
      bindingId,
      projectId: project.id,
      manuscriptId: manuscript.id,
      providerId: 'overleaf_git',
      capabilitiesSnapshot: {
        ...descriptor.capabilities,
        interactionModes: ['checkpoint_pull'],
      },
      authority: 'provider',
      enabled: true,
      version: 1,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
    providerDisplayName: 'Overleaf Git',
    workspaceUrl: 'https://www.overleaf.com/project/0123456789abcdef01234567',
    lifecycle: 'ready',
    syncState: 'provider_ahead',
    anchor: {
      schemaVersion: 1,
      bindingId,
      generation: 0,
      lastCommonRevision: null,
      providerRevision: null,
      gosuRevision: 'b'.repeat(40),
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
    lastObservedProviderRevision: providerRevision,
    lastObservedAt: '2026-08-11T00:00:00.000Z',
    lastFailureCode: null,
    lastCheckpoint: null,
  };
}

function checkpointFixture(providerRevision = 'a'.repeat(40)) {
  return {
    schemaVersion: 1 as const,
    checkpointId: '55555555-5555-4555-8555-555555555555',
    bindingId,
    projectId: project.id,
    manuscriptId: manuscript.id,
    providerId: 'overleaf_git',
    direction: 'fetch' as const,
    sourceAuthority: 'provider' as const,
    sourceRevision: providerRevision,
    gosuRevision: 'b'.repeat(40),
    providerRevision,
    cursor: providerRevision,
    revisionEnvelopeDigest: `sha256:${'c'.repeat(64)}`,
    rootDocument: manuscript.rootDocument,
    baseCheckpointId: null,
    actorId: '66666666-6666-4666-8666-666666666666',
    observedAt: '2026-08-11T00:00:00.000Z',
  };
}

function prepare(snapshot: ManuscriptWorkspaceSnapshot) {
  hookState.index = 0;
  hookState.snapshot = snapshot;
}

beforeEach(() => {
  hookState.index = 0;
  hookState.snapshot = null;
});

describe('Manuscript workspace view', () => {
  it('validates project-relative TeX roots before submitting a manuscript', () => {
    expect(validManuscriptRootDocument('paper/main.tex')).toBe(true);
    expect(validManuscriptRootDocument('main.tex')).toBe(true);
    expect(validManuscriptRootDocument('/private/main.tex')).toBe(false);
    expect(validManuscriptRootDocument('../main.tex')).toBe(false);
    expect(validManuscriptRootDocument('paper\\main.tex')).toBe(false);
    expect(validManuscriptRootDocument('paper//main.tex')).toBe(false);
    expect(validManuscriptRootDocument('paper/main.md')).toBe(false);
  });

  it('responds to the manuscript pane width instead of the full window width', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(/\.manuscript-workspace\s*\{[^}]*container-type:\s*inline-size;/su);
    expect(styles).toMatch(
      /@container \(max-width: 720px\)[\s\S]*?\.manuscript-form-grid,[\s\S]*?\.manuscript-status-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/u,
    );
  });

  it('connects each manuscript independently without presenting realtime Git as supported', () => {
    prepare({
      schemaVersion: 1,
      projectId: project.id,
      providers: [descriptor],
      manuscripts: [
        { manuscript, connection: null },
        {
          manuscript: {
            ...manuscript,
            id: '33333333-3333-4333-8333-333333333333',
            title: 'Supplement',
            rootDocument: 'supplement/main.tex',
          },
          connection: null,
        },
      ],
    });

    const html = renderToStaticMarkup(<ManuscriptView project={project} />);

    expect(html).toContain('Main manuscript');
    expect(html).toContain('Supplement');
    expect(html.match(/Overleaf Git URL/gu)).toHaveLength(2);
    expect(html.match(/type="password"/gu)).toHaveLength(2);
    expect(html).toContain('Saved to macOS Keychain');
    expect(html).toContain('Captures inbound Git checkpoints only');
    expect(html.match(/Edit manuscript name or root document/gu)).toHaveLength(2);
    expect(html).toContain('Save manuscript details');
  });

  it('describes capture truthfully, derives realtime copy from capabilities, and exposes no publish', () => {
    const providerRevision = 'a'.repeat(40);
    prepare({
      schemaVersion: 1,
      projectId: project.id,
      providers: [descriptor],
      manuscripts: [
        {
          manuscript,
          connection: connectionFixture(providerRevision),
        },
      ],
    });

    const html = renderToStaticMarkup(<ManuscriptView project={project} />);

    expect(html).toContain('New provider revision observed');
    expect(html).toContain('Open workspace');
    expect(html).toContain('Check Overleaf changes');
    expect(html).toContain('Baseline not captured');
    expect(html).toContain('Capture inbound checkpoint');
    expect(html).toContain('Provider authority');
    expect(html).not.toContain('Overleaf Git live');
    expect(html).toContain('Realtime editing: not available through GOSU');
    expect(html).toContain('not imported or reviewable in GOSU yet');
    expect(html).toContain('not imported into the GOSU draft');
    expect(html).toContain('Future engines');
    expect(html).toContain('GOSU Local LaTeX');
    expect(html).not.toMatch(/>Push</u);
    expect(html).not.toMatch(/>Publish</u);
  });

  it('compares only a checkpoint captured for the active Overleaf binding', () => {
    const connection = connectionFixture();
    expect(deriveManuscriptProviderChange(connection)).toMatchObject({
      state: 'baseline_required',
      title: 'Baseline not captured',
    });

    const oldBindingCheckpoint = {
      ...checkpointFixture(),
      bindingId: '77777777-7777-4777-8777-777777777777',
    };
    expect(
      deriveManuscriptProviderChange({ ...connection, lastCheckpoint: oldBindingCheckpoint }),
    ).toMatchObject({ state: 'baseline_required' });
  });

  it('reports unchanged and changed revisions without claiming collaborator identity or merge safety', () => {
    const checkpoint = checkpointFixture();
    const unchanged = deriveManuscriptProviderChange({
      ...connectionFixture(),
      lastCheckpoint: checkpoint,
    });
    expect(unchanged).toMatchObject({
      state: 'unchanged',
      title: 'No new Overleaf Git revision',
    });

    const changed = deriveManuscriptProviderChange({
      ...connectionFixture('d'.repeat(40)),
      lastCheckpoint: checkpoint,
    });
    expect(changed).toMatchObject({
      state: 'provider_changed',
      title: 'Overleaf Git revision changed',
    });
    expect(JSON.stringify(changed)).toContain('Source-level conflict has not been evaluated');
    expect(JSON.stringify(changed)).not.toMatch(/collaborator|conflict detected|conflict-free/iu);
  });

  it('marks a failed read-only check as stale without claiming a remote mutation', () => {
    const failed = deriveManuscriptProviderChange(connectionFixture(), true);
    expect(failed).toMatchObject({ state: 'check_failed', title: "Couldn't check Overleaf" });
    expect(failed.detail).toContain('may be stale');
    expect(failed.detail).toContain('No remote files were changed');
  });
});
