import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ResearchNotesService,
  type ResearchNotesProjectLink,
  type ResearchNotesStorage,
} from '../src/main/research-notes-service';
import { VaultAccess } from '../src/main/vault';
import type { WorkspaceService } from '../src/main/workspace-service';
import type { LiteratureRecord } from '../src/shared/literature-contracts';
import type { ProjectRecord, WorkspaceSnapshot } from '../src/shared/workspace-contracts';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RECORD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-08-06T00:00:00.000Z');
const temporaryDirectories: string[] = [];

class MemoryResearchNotesStorage implements ResearchNotesStorage {
  readonly links = new Map<string, ResearchNotesProjectLink>();

  loadProjectLink(projectId: string) {
    return structuredClone(this.links.get(projectId) ?? null);
  }

  saveProjectLink(link: ResearchNotesProjectLink) {
    this.links.set(link.projectId, structuredClone(link));
  }
}

function project(id: string, name: string, overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id,
    name,
    slug: name.toLocaleLowerCase().replaceAll(' ', '-'),
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function paper(overrides: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    schemaVersion: 1,
    id: RECORD_ID,
    projectId: PROJECT_ID,
    provider: 'crossref',
    providerRecordId: '10.1000/fixture',
    doi: '10.1000/fixture',
    fingerprint: 'a'.repeat(64),
    title: 'A fixture paper',
    authors: ['Ada Researcher'],
    containerTitle: 'Journal of Fixtures',
    publishedYear: 2025,
    sourceTopics: ['evaluation'],
    searchTags: { topics: ['foundation models'], keywords: ['tabular'] },
    workType: 'journal-article',
    citationCount: 12,
    sourceUrl: 'https://doi.org/10.1000/fixture',
    citationKey: 'Researcher2025Fixture',
    reviewStatus: 'included',
    manualAnnotations: { topics: [], summary: '', relevance: '' },
    aiAnnotations: null,
    discovery: null,
    annotationVersion: 0,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

async function temporaryVault() {
  const created = await mkdtemp(join(tmpdir(), 'gosu-research-notes-service-'));
  temporaryDirectories.push(created);
  return realpath(created);
}

async function fixture(input?: {
  projects?: ProjectRecord[];
  records?: LiteratureRecord[];
  connectVault?: boolean;
}) {
  const root = await temporaryVault();
  const projects = input?.projects ?? [
    project(PROJECT_ID, 'Alpha Project'),
    project(OTHER_PROJECT_ID, 'Beta Project'),
  ];
  const records = input?.records ?? [paper()];
  const snapshot = (): WorkspaceSnapshot => ({
    schemaVersion: 1,
    revision: 1,
    projects: structuredClone(projects),
    tasks: [],
    objectives: [],
  });
  const workspace = { snapshot: vi.fn(async () => snapshot()) } as unknown as WorkspaceService;
  const storage = new MemoryResearchNotesStorage();
  const vault = new VaultAccess();
  if (input?.connectVault !== false) await vault.connect(root, false);
  const literature = {
    listLiteratureRecords: vi.fn(async (projectId: string) =>
      records.filter((record) => record.projectId === projectId),
    ),
    getLiteratureRecordsByIds: vi.fn(async (projectId: string, ids: readonly string[]) =>
      records.filter((record) => record.projectId === projectId && ids.includes(record.id)),
    ),
  };
  const service = new ResearchNotesService({
    storage,
    literature,
    workspace,
    vault,
    now: () => NOW,
  });
  return { root, projects, records, storage, vault, literature, service };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('ResearchNotesService project workspaces', () => {
  it('creates the default GOSU project structure and initial Literature projection', async () => {
    const { root, storage, service } = await fixture();

    const workspace = await service.current({ projectId: PROJECT_ID });

    expect(workspace).toMatchObject({
      projectId: PROJECT_ID,
      projectName: 'Alpha Project',
      displayRoot: expect.stringContaining('/GOSU/Alpha Project'),
      status: 'ready',
      folders: ['Literature', 'Papers', 'Experiments', 'Project Progress', 'Idea Development'],
    });
    expect(workspace?.files).toEqual(
      expect.arrayContaining([
        'Literature/Literature Review.md',
        'Papers/Papers Index.md',
        'Experiments/Experiment Log.md',
        'Project Progress/Project Progress.md',
        'Idea Development/Idea Development.md',
      ]),
    );
    const projection = await readFile(
      join(root, 'GOSU', 'Alpha Project', 'Literature', 'Literature Review.md'),
      'utf8',
    );
    expect(projection).toContain('A fixture paper');
    expect(projection).toContain('metadata_only: true');
    expect(storage.links.get(PROJECT_ID)?.lastLiteratureSyncAt).toBe(NOW.toISOString());
  });

  it('keeps listing and agent reads scoped to the granted project folder', async () => {
    const { root, service } = await fixture();
    const alpha = await service.current({ projectId: PROJECT_ID });
    const beta = await service.current({ projectId: OTHER_PROJECT_ID });
    expect(alpha).not.toBeNull();
    expect(beta).not.toBeNull();
    await writeFile(
      join(root, 'GOSU', 'Alpha Project', 'Idea Development', 'Alpha Secret.md'),
      '# Alpha-only note\n',
    );
    await writeFile(
      join(root, 'GOSU', 'Beta Project', 'Idea Development', 'Beta Secret.md'),
      '# Beta-only note\n',
    );

    const alphaNotes = await service.listForAgent(PROJECT_ID, alpha!.bindingId, '', 100);
    const betaNotes = await service.listForAgent(OTHER_PROJECT_ID, beta!.bindingId, '', 100);
    expect(alphaNotes.notes.map((note) => note.title)).toContain('Alpha Secret');
    expect(alphaNotes.notes.map((note) => note.title)).not.toContain('Beta Secret');
    expect(betaNotes.notes.map((note) => note.title)).toContain('Beta Secret');
    expect(betaNotes.notes.map((note) => note.title)).not.toContain('Alpha Secret');

    const alphaSecret = alphaNotes.notes.find((note) => note.title === 'Alpha Secret')!;
    await expect(
      service.readForAgent(PROJECT_ID, alpha!.bindingId, alphaSecret.noteId),
    ).resolves.toMatchObject({ content: '# Alpha-only note\n', title: 'Alpha Secret' });
    await expect(
      service.readForAgent(OTHER_PROJECT_ID, beta!.bindingId, alphaSecret.noteId),
    ).rejects.toThrow('vault_note_not_found');
  });

  it('keeps a collision-safe suffixed project folder ready across reopen', async () => {
    const { root, service, vault } = await fixture();
    await mkdir(join(root, 'GOSU', 'Alpha Project'), { recursive: true });
    await writeFile(join(root, 'GOSU', 'Alpha Project', 'foreign.md'), '# User folder\n');

    const first = await service.current({ projectId: PROJECT_ID });
    const reopened = await service.current({ projectId: PROJECT_ID });
    vi.spyOn(vault, 'choose').mockResolvedValue(vault.current());
    const reselected = await service.chooseVault({ projectId: PROJECT_ID }, {} as BrowserWindow);

    expect(first).toMatchObject({
      status: 'ready',
      attentionCode: null,
      displayRoot: expect.stringContaining(`/GOSU/Alpha Project--${PROJECT_ID.slice(0, 8)}`),
    });
    expect(reopened).toMatchObject({
      bindingId: first?.bindingId,
      status: 'ready',
      attentionCode: null,
      displayRoot: first?.displayRoot,
    });
    expect(reselected).toMatchObject({
      bindingId: first?.bindingId,
      status: 'ready',
      attentionCode: null,
      displayRoot: first?.displayRoot,
    });
    await expect(readFile(join(root, 'GOSU', 'Alpha Project', 'foreign.md'), 'utf8')).resolves.toBe(
      '# User folder\n',
    );
  });

  it('rejects project traversal and stale cross-project binding grants', async () => {
    const { service } = await fixture();
    const alpha = await service.current({ projectId: PROJECT_ID });
    const beta = await service.current({ projectId: OTHER_PROJECT_ID });

    await expect(
      service.read({ projectId: PROJECT_ID, path: '../Beta Project/Papers/Papers Index.md' }),
    ).rejects.toThrow('research_notes_note_not_found');
    await expect(service.listForAgent(PROJECT_ID, beta!.bindingId)).rejects.toThrow(
      'vault_grant_stale',
    );
    await expect(service.validateGrant(PROJECT_ID, alpha!.bindingId)).resolves.toBeUndefined();
  });

  it('renames an owned Obsidian project folder when the project name changes', async () => {
    const { root, projects, storage, service } = await fixture();
    await service.current({ projectId: PROJECT_ID });
    projects[0] = project(PROJECT_ID, 'Renamed Project', {
      version: 2,
      updatedAt: '2026-08-06T01:00:00.000Z',
    });

    await service.projectRenamed(projects[0]!);

    await expect(
      readFile(join(root, 'GOSU', 'Alpha Project', '.gosu-project.json')),
    ).rejects.toThrow();
    await expect(
      readFile(join(root, 'GOSU', 'Renamed Project', '.gosu-project.json'), 'utf8'),
    ).resolves.toContain('Renamed Project');
    expect(storage.links.get(PROJECT_ID)).toMatchObject({
      projectName: 'Renamed Project',
      folderName: 'Renamed Project',
      status: 'ready',
      attentionCode: null,
    });
  });

  it('supports project renames that differ only by filesystem case', async () => {
    const { root, projects, storage, service } = await fixture();
    await service.current({ projectId: PROJECT_ID });
    projects[0] = project(PROJECT_ID, 'alpha project', {
      version: 2,
      updatedAt: '2026-08-06T01:00:00.000Z',
    });

    await service.projectRenamed(projects[0]!);

    await expect(
      readFile(join(root, 'GOSU', 'alpha project', '.gosu-project.json'), 'utf8'),
    ).resolves.toContain('alpha project');
    expect(storage.links.get(PROJECT_ID)).toMatchObject({
      projectName: 'alpha project',
      folderName: 'alpha project',
      status: 'ready',
      attentionCode: null,
    });
  });

  it('retries a failed Literature projection when the project notes are opened again', async () => {
    const { root, literature, service } = await fixture();
    literature.listLiteratureRecords.mockRejectedValueOnce(new Error('temporary disk failure'));

    await service.current({ projectId: PROJECT_ID });
    await expect(
      readFile(join(root, 'GOSU', 'Alpha Project', 'Literature', 'Literature Review.md')),
    ).rejects.toThrow();

    await service.current({ projectId: PROJECT_ID });

    await expect(
      readFile(join(root, 'GOSU', 'Alpha Project', 'Literature', 'Literature Review.md'), 'utf8'),
    ).resolves.toContain('A fixture paper');
  });

  it('preserves the old folder and records attention when a rename destination is occupied', async () => {
    const { root, projects, storage, service } = await fixture();
    await service.current({ projectId: PROJECT_ID });
    await mkdir(join(root, 'GOSU', 'Occupied Project'));
    projects[0] = project(PROJECT_ID, 'Occupied Project', {
      version: 2,
      updatedAt: '2026-08-06T01:00:00.000Z',
    });

    await service.projectRenamed(projects[0]!);

    await expect(
      readFile(join(root, 'GOSU', 'Alpha Project', '.gosu-project.json')),
    ).resolves.toBeDefined();
    expect(storage.links.get(PROJECT_ID)).toMatchObject({
      folderName: 'Alpha Project',
      desiredFolderName: 'Occupied Project',
      status: 'rename-pending',
      attentionCode: 'folder_name_conflict',
    });
  });

  it('creates each paper note once and never overwrites later human edits', async () => {
    const { root, service } = await fixture();
    await service.current({ projectId: PROJECT_ID });

    const first = await service.createPaperNote({ projectId: PROJECT_ID, recordId: RECORD_ID });
    expect(first).toMatchObject({ projectId: PROJECT_ID, recordId: RECORD_ID, created: true });
    const absolutePath = join(root, 'GOSU', 'Alpha Project', first.path);
    const generated = await readFile(absolutePath, 'utf8');
    expect(generated).toContain('The paper full text was not read or verified.');
    await writeFile(absolutePath, `${generated}\n## Researcher conclusion\nKeep this note.\n`);

    const second = await service.createPaperNote({ projectId: PROJECT_ID, recordId: RECORD_ID });

    expect(second).toEqual({ ...first, created: false });
    await expect(readFile(absolutePath, 'utf8')).resolves.toContain('Keep this note.');
  });

  it('does not expose or create project notes until an Obsidian Vault is connected', async () => {
    const { root, storage, service } = await fixture({ connectVault: false });

    await expect(service.current({ projectId: PROJECT_ID })).resolves.toBeNull();
    expect(storage.links.size).toBe(0);
    await expect(readFile(join(root, 'GOSU'))).rejects.toThrow();
  });

  it('rejects paper note creation for another project or an unknown record', async () => {
    const { service } = await fixture();
    await service.current({ projectId: PROJECT_ID });

    await expect(
      service.createPaperNote({
        projectId: OTHER_PROJECT_ID,
        recordId: RECORD_ID,
      }),
    ).rejects.toMatchObject({ code: 'research_notes_record_not_found' });
    await expect(
      service.createPaperNote({
        projectId: PROJECT_ID,
        recordId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).rejects.toMatchObject({ code: 'research_notes_record_not_found' });
  });
});
