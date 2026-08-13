import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ResearchNotesAgentMarkdownReceiptSchema,
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
  now?: () => Date;
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
    now: input?.now ?? (() => NOW),
  });
  return { root, projects, records, storage, vault, literature, workspace, service };
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
      folders: [
        'Literature',
        'Papers',
        'Experiments',
        'Project Progress',
        'Idea Development',
        'Lecture Notes & Slides',
      ],
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
    expect(projection).toContain('gosu_schema_version: 2');
    expect(projection).toContain('metadata_only: true');
    const experimentLog = await readFile(
      join(root, 'GOSU', 'Alpha Project', 'Experiments', 'Experiment Log.md'),
      'utf8',
    );
    expect(experimentLog).toContain('gosu_document_kind: "experiment-log"');
    expect(experimentLog).toContain(`created_at: ${JSON.stringify(NOW.toISOString())}`);
    expect(experimentLog).toContain('gosu_origin: "project-workspace"');
    expect(experimentLog).toContain('gosu_origin_session_id: null');
    expect(experimentLog).toContain('gosu_creator_id: "gosu-system"');
    expect(experimentLog).toContain('related_documents: []');
    expect(experimentLog).toContain('related_papers: []');
    expect(storage.links.get(PROJECT_ID)?.lastLiteratureSyncAt).toBe(NOW.toISOString());
  });

  it('inspects an existing ready workspace without creating or synchronizing Markdown', async () => {
    const { root, storage, literature, service } = await fixture();

    await expect(service.inspectReadyWorkspace({ projectId: PROJECT_ID })).resolves.toBeNull();
    expect(storage.links.size).toBe(0);
    expect(literature.listLiteratureRecords).not.toHaveBeenCalled();
    await expect(readFile(join(root, 'GOSU'))).rejects.toThrow();

    await service.current({ projectId: PROJECT_ID });
    const durableLink = structuredClone(storage.links.get(PROJECT_ID));
    literature.listLiteratureRecords.mockClear();
    const saveLink = vi.spyOn(storage, 'saveProjectLink');

    const inspected = await service.inspectReadyWorkspace({ projectId: PROJECT_ID });

    expect(inspected).toMatchObject({
      projectId: PROJECT_ID,
      projectName: 'Alpha Project',
      status: 'ready',
    });
    expect(inspected?.files).toContain('Literature/Literature Review.md');
    await expect(
      service.readReadyMarkdown({
        projectId: PROJECT_ID,
        path: 'Literature/Literature Review.md',
      }),
    ).resolves.toMatchObject({
      path: 'Literature/Literature Review.md',
      content: expect.stringContaining('A fixture paper'),
    });
    expect(literature.listLiteratureRecords).not.toHaveBeenCalled();
    expect(saveLink).not.toHaveBeenCalled();
    expect(storage.links.get(PROJECT_ID)).toEqual(durableLink);
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

  it('saves agent Markdown only inside the selected Research Notes category folder', async () => {
    const { root, service } = await fixture();
    const workspace = await service.current({ projectId: PROJECT_ID });
    const categories = [
      ['literature', 'Literature'],
      ['papers', 'Papers'],
      ['experiments', 'Experiments'],
      ['project-progress', 'Project Progress'],
      ['idea-development', 'Idea Development'],
      ['lectures', 'Lecture Notes & Slides'],
    ] as const;

    for (const [category, folder] of categories) {
      const content = `# ${folder} artifact\n`;
      const receipt = await service.saveMarkdownForAgent(PROJECT_ID, workspace!.bindingId, {
        category,
        title: `${folder} / plan?.md`,
        content,
        idempotencyKey: `turn-1:${category}`,
      });

      expect(receipt).toMatchObject({
        schemaVersion: 1,
        projectId: PROJECT_ID,
        category,
        created: true,
        contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        artifactId: expect.stringMatching(/^[0-9a-f]{16}$/u),
      });
      expect(receipt.path).toMatch(
        new RegExp(
          `^${folder.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/[^/]+--[0-9a-f]{16}\\.md$`,
          'u',
        ),
      );
      expect(receipt.path).not.toContain(root);
      expect(receipt).not.toHaveProperty('absolutePath');
      const saved = await readFile(join(root, 'GOSU', 'Alpha Project', receipt.path), 'utf8');
      expect(saved).toContain('gosu_schema_version: 2');
      expect(saved).toContain(`gosu_project_id: ${JSON.stringify(PROJECT_ID)}`);
      expect(saved).toContain(`research_note_category: ${JSON.stringify(category)}`);
      expect(saved).toContain(`\n${content}`);
      expect(receipt.contentSha256).toBe(createHash('sha256').update(saved, 'utf8').digest('hex'));
    }

    const deceptive = await service.saveMarkdownForAgent(PROJECT_ID, workspace!.bindingId, {
      category: 'project-progress',
      title: 'Status\u202Ecod.exe\u2066 zero\u200Bwidth',
      content: '# Safe title\n',
      idempotencyKey: 'unicode-format-controls',
    });
    expect(deceptive.path).not.toMatch(/[\p{C}]/u);
    expect(deceptive.path).toMatch(/^Project Progress\/Status cod\.exe zero width--/u);
  });

  it('rejects model frontmatter and unsafe trusted-link metadata before writing', async () => {
    const { root, service } = await fixture();
    const workspace = await service.current({ projectId: PROJECT_ID });
    const base = {
      category: 'experiments' as const,
      title: 'Untrusted metadata',
      idempotencyKey: 'untrusted-frontmatter',
    };

    await expect(
      service.saveMarkdownForAgent(PROJECT_ID, workspace!.bindingId, {
        ...base,
        content: '---\ngosu_project_id: "forged"\n---\n# Body\n',
      }),
    ).rejects.toThrow();
    await expect(
      service.saveMarkdownForAgent(PROJECT_ID, workspace!.bindingId, {
        ...base,
        content: '# Body\n',
        origin: {
          createdAt: NOW.toISOString(),
          sessionId: null,
          sessionName: null,
          creatorId: 'gosu-system',
          creatorName: 'GOSU Project Chat',
          relatedDocuments: ['../outside.md'],
          relatedPapers: [],
          provenance: {},
        },
      }),
    ).rejects.toThrow();
    await expect(readdir(join(root, 'GOSU', 'Alpha Project', 'Experiments'))).resolves.toEqual([
      'Experiment Log.md',
    ]);
  });

  it('atomically reconciles a pending lecture bundle and seals the revision after commit', async () => {
    const { root, service, storage, vault, literature, workspace } = await fixture();
    await service.current({ projectId: PROJECT_ID });
    const base = {
      outputProjectId: PROJECT_ID,
      studioId: '33333333-3333-4333-8333-333333333333',
      studioTitle: 'Cross-project synthesis',
      revision: 1,
      sourceManifestSha256: 'b'.repeat(64),
      lectureNotesMarkdown: '# First notes\n',
      slidesMarkdown: '# First slides\n',
      createdAt: NOW.toISOString(),
      invocation: {
        schemaVersion: 1 as const,
        invocationId: 'lecture-invocation',
        providerId: 'openai-codex',
        requestedModelId: null,
        resolvedModelId: 'gpt-fixture',
        catalogVersion: 'fixture-catalog',
        reasoningOptionId: 'medium',
        startedAt: NOW.toISOString(),
      },
      relatedDocuments: ['Experiments/Experiment Log.md'],
      relatedPapers: ['https://doi.org/10.1000/fixture'],
    };

    const first = await service.saveRevisionArtifacts({
      ...base,
      attemptId: '44444444-4444-4444-8444-444444444444',
    });
    const retriedSameAttempt = await service.saveRevisionArtifacts({
      ...base,
      attemptId: '44444444-4444-4444-8444-444444444444',
    });
    const recoveryInput = {
      ...base,
      attemptId: '55555555-5555-4555-8555-555555555555',
      lectureNotesMarkdown: '# Recovered notes\n',
      slidesMarkdown: '# Recovered slides\n',
    };
    const recoveredWithNewAttempt = await service.saveRevisionArtifacts(recoveryInput);

    expect(retriedSameAttempt).toEqual(first);
    expect(recoveredWithNewAttempt.map((artifact) => artifact.relativePath)).toEqual(
      first.map((artifact) => artifact.relativePath),
    );
    const recoveredNotesPath = join(root, 'GOSU', 'Alpha Project', first[0].relativePath);
    const recoveredNotes = await readFile(recoveredNotesPath, 'utf8');
    expect(recoveredNotes).toContain('# Recovered notes');
    expect(recoveredNotes).toContain('gosu_schema_version: 2');
    expect(recoveredNotes).toContain('gosu_document_kind: "lecture-notes"');
    expect(recoveredNotes).toContain('gosu_creator_id: "gpt-fixture"');
    expect(recoveredNotes).toContain('gosu_origin_session_id: null');
    expect(recoveredNotes).toContain('related_documents: ["Experiments/Experiment Log.md"]');
    expect(recoveredNotes).toContain('related_papers: ["https://doi.org/10.1000/fixture"]');
    await expect(
      readFile(
        join(root, 'GOSU', 'Alpha Project', recoveredWithNewAttempt[0].relativePath),
        'utf8',
      ),
    ).resolves.toContain('# Recovered notes');
    const bundlePath = dirname(
      join(root, 'GOSU', 'Alpha Project', recoveredWithNewAttempt[0].relativePath),
    );
    await expect(readdir(bundlePath)).resolves.toContain('.gosu-pending-bundle.json');

    const restarted = new ResearchNotesService({
      storage,
      literature,
      workspace,
      vault,
      now: () => NOW,
    });
    const pending = await restarted.listPendingRevisionArtifacts();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      outputProjectId: PROJECT_ID,
      studioId: base.studioId,
      revision: 1,
      attemptId: recoveryInput.attemptId,
      sourceManifestSha256: base.sourceManifestSha256,
      relativeBundlePath: dirname(recoveredWithNewAttempt[0].relativePath),
    });

    await restarted.confirmPendingRevisionArtifacts(pending[0]!);
    expect((await readdir(bundlePath)).sort()).toEqual(['Lecture Notes.md', 'Slides.md']);
    const resolved = await restarted.resolveLectureRevisionArtifact(
      PROJECT_ID,
      recoveredWithNewAttempt[0],
    );
    expect(resolved).toMatchObject({
      absolutePath: recoveredNotesPath,
      relativePath: recoveredWithNewAttempt[0].relativePath,
      fileName: 'Lecture Notes.md',
      contentSha256: recoveredWithNewAttempt[0].contentSha256,
    });
    expect(resolved.content).toContain('# Recovered notes');
    expect(resolved.content).toContain('gosu_document_kind: "lecture-notes"');

    await writeFile(recoveredNotesPath, `${resolved.content}\nRenderer mutation`, 'utf8');
    await expect(
      restarted.resolveLectureRevisionArtifact(PROJECT_ID, recoveredWithNewAttempt[0]),
    ).rejects.toMatchObject({ code: 'research_notes_folder_conflict' });
    await expect(service.saveRevisionArtifacts(recoveryInput)).rejects.toThrow(
      'research_notes_folder_conflict',
    );
  });

  it('preflights the lecture destination with a cleaned-up write probe', async () => {
    const { root, service } = await fixture();
    await service.current({ projectId: PROJECT_ID });
    const lectureDirectory = join(root, 'GOSU', 'Alpha Project', 'Lecture Notes & Slides');
    await rm(lectureDirectory, { recursive: true });

    await service.assertRevisionDestination(PROJECT_ID);

    expect(await readdir(lectureDirectory)).toEqual([]);
  });

  it('never replaces a pending bundle whose immutable journal identity disagrees', async () => {
    const { root, service } = await fixture();
    await service.current({ projectId: PROJECT_ID });
    const input = {
      outputProjectId: PROJECT_ID,
      studioId: '33333333-3333-4333-8333-333333333333',
      studioTitle: 'Identity conflict',
      revision: 1,
      attemptId: '44444444-4444-4444-8444-444444444444',
      sourceManifestSha256: 'd'.repeat(64),
      lectureNotesMarkdown: '# Original notes\n',
      slidesMarkdown: '# Original slides\n',
      createdAt: NOW.toISOString(),
    };
    const artifacts = await service.saveRevisionArtifacts(input);
    const notesPath = join(root, 'GOSU', 'Alpha Project', artifacts[0].relativePath);
    const bundlePath = dirname(notesPath);
    const journalPath = join(bundlePath, '.gosu-pending-bundle.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Record<string, unknown>;
    await writeFile(
      journalPath,
      `${JSON.stringify(
        {
          ...journal,
          studioId: '66666666-6666-4666-8666-666666666666',
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    await expect(
      service.saveRevisionArtifacts({
        ...input,
        attemptId: '55555555-5555-4555-8555-555555555555',
        lectureNotesMarkdown: '# Replacement notes\n',
        slidesMarkdown: '# Replacement slides\n',
      }),
    ).rejects.toThrow('research_notes_folder_conflict');
    await expect(readFile(notesPath, 'utf8')).resolves.toContain('# Original notes');
    await expect(readFile(journalPath, 'utf8')).resolves.toContain(
      '66666666-6666-4666-8666-666666666666',
    );
  });

  it('rolls back both pending lecture artifacts as one exact-hash bundle', async () => {
    const { root, service } = await fixture();
    await service.current({ projectId: PROJECT_ID });
    const input = {
      outputProjectId: PROJECT_ID,
      studioId: '33333333-3333-4333-8333-333333333333',
      studioTitle: 'Rollback synthesis',
      revision: 1,
      attemptId: '44444444-4444-4444-8444-444444444444',
      sourceManifestSha256: 'c'.repeat(64),
      lectureNotesMarkdown: '# Pending notes\n',
      slidesMarkdown: '# Pending slides\n',
      createdAt: NOW.toISOString(),
    };
    const artifacts = await service.saveRevisionArtifacts(input);
    const notesPath = join(root, 'GOSU', 'Alpha Project', artifacts[0].relativePath);
    const slidesPath = join(root, 'GOSU', 'Alpha Project', artifacts[1].relativePath);
    await expect(readFile(notesPath, 'utf8')).resolves.toContain('# Pending notes');
    await expect(readFile(slidesPath, 'utf8')).resolves.toContain('# Pending slides');

    const pending = await service.listPendingRevisionArtifacts();
    expect(pending).toHaveLength(1);
    await service.rollbackPendingRevisionArtifacts(pending[0]!);

    await expect(readFile(notesPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(slidesPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retries an agent Markdown write only when the generated path and content are exact', async () => {
    const { root, service } = await fixture();
    const workspace = await service.current({ projectId: PROJECT_ID });
    const input = {
      category: 'idea-development' as const,
      title: 'Ablation / `idea`?.md',
      content: '# Ablation idea\n\nTry a narrower prior.\n',
      idempotencyKey: 'session-1:turn-9:tool-2',
    };

    const first = await service.saveMarkdownForAgent(PROJECT_ID, workspace!.bindingId, input);
    const retried = await service.saveMarkdownForAgent(PROJECT_ID, workspace!.bindingId, input);

    expect(first.path).toMatch(/^Idea Development\/Ablation idea--[0-9a-f]{16}\.md$/u);
    expect(retried).toEqual({ ...first, created: false });
    await expect(
      service.recoverMarkdownForAgent(PROJECT_ID, workspace!.bindingId, {
        category: input.category,
        artifactId: first.artifactId,
        expectedContentSha256: first.contentSha256,
      }),
    ).resolves.toEqual({ ...first, created: false });
    await expect(
      service.recoverMarkdownForAgent(PROJECT_ID, workspace!.bindingId, {
        category: input.category,
        artifactId: first.artifactId,
        expectedContentSha256: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'research_notes_save_commit_uncertain' });
    await expect(
      service.saveMarkdownForAgent(PROJECT_ID, workspace!.bindingId, {
        ...input,
        content: '# A different generated artifact\n',
      }),
    ).rejects.toThrow('research_notes_folder_conflict');
    await expect(
      service.saveMarkdownForAgent(PROJECT_ID, workspace!.bindingId, {
        ...input,
        title: 'A different title',
      }),
    ).rejects.toThrow('research_notes_folder_conflict');
    const saved = await readFile(join(root, 'GOSU', 'Alpha Project', first.path), 'utf8');
    expect(saved).toContain('gosu_document_kind: "project-chat-artifact"');
    expect(saved).toContain(`\n${input.content}`);
  });

  it('reports a commit-uncertain error when the Vault grant changes after an agent write', async () => {
    const { root, service, vault } = await fixture();
    const workspace = await service.current({ projectId: PROJECT_ID });
    vi.spyOn(vault, 'validateGrant')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('vault changed after write'));
    const content = '# Status before handoff\n';

    await expect(
      service.saveMarkdownForAgent(PROJECT_ID, workspace!.bindingId, {
        category: 'project-progress',
        title: 'Status before handoff',
        content,
        idempotencyKey: 'commit-uncertain-fixture',
      }),
    ).rejects.toMatchObject({ code: 'research_notes_save_commit_uncertain' });

    const files = await readdir(join(root, 'GOSU', 'Alpha Project', 'Project Progress'));
    const created = files.find((path) => path.startsWith('Status before handoff--'));
    expect(created).toMatch(/\.md$/u);
    const saved = await readFile(
      join(root, 'GOSU', 'Alpha Project', 'Project Progress', created!),
      'utf8',
    );
    expect(saved).toContain('gosu_schema_version: 2');
    expect(saved).toContain(`\n${content}`);
  });

  it('reports commit-uncertain when the project or binding changes after the file write', async () => {
    const first = await fixture();
    const firstWorkspace = await first.service.current({ projectId: PROJECT_ID });
    const activeSnapshot = await first.workspace.snapshot();
    const archivedSnapshot: WorkspaceSnapshot = {
      ...structuredClone(activeSnapshot),
      projects: activeSnapshot.projects.map((candidate) =>
        candidate.id === PROJECT_ID
          ? { ...candidate, archivedAt: '2026-08-06T00:00:01.000Z' }
          : candidate,
      ),
    };
    vi.mocked(first.workspace.snapshot)
      .mockResolvedValueOnce(activeSnapshot)
      .mockResolvedValueOnce(archivedSnapshot);

    await expect(
      first.service.saveMarkdownForAgent(PROJECT_ID, firstWorkspace!.bindingId, {
        category: 'project-progress',
        title: 'Archived during save',
        content: '# Archived during save\n',
        idempotencyKey: 'archived-during-save',
      }),
    ).rejects.toMatchObject({ code: 'research_notes_save_commit_uncertain' });

    const second = await fixture();
    const secondWorkspace = await second.service.current({ projectId: PROJECT_ID });
    const secondSnapshot = await second.workspace.snapshot();
    vi.mocked(second.workspace.snapshot)
      .mockResolvedValueOnce(secondSnapshot)
      .mockImplementationOnce(async () => {
        const link = second.storage.links.get(PROJECT_ID)!;
        second.storage.links.set(PROJECT_ID, { ...link, bindingId: 'e'.repeat(64) });
        return secondSnapshot;
      });

    await expect(
      second.service.saveMarkdownForAgent(PROJECT_ID, secondWorkspace!.bindingId, {
        category: 'project-progress',
        title: 'Binding changed during save',
        content: '# Binding changed during save\n',
        idempotencyKey: 'binding-changed-during-save',
      }),
    ).rejects.toMatchObject({ code: 'research_notes_save_commit_uncertain' });
  });

  it('does not issue a success receipt when the written file changes before final verification', async () => {
    const { root, service, workspace } = await fixture();
    const researchWorkspace = await service.current({ projectId: PROJECT_ID });
    const snapshot = await workspace.snapshot();
    vi.mocked(workspace.snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockImplementationOnce(async () => {
        const directory = join(root, 'GOSU', 'Alpha Project', 'Project Progress');
        const file = (await readdir(directory)).find((candidate) =>
          candidate.startsWith('Concurrent mutation--'),
        );
        expect(file).toBeDefined();
        await writeFile(join(directory, file!), '# Changed by another process\n');
        return snapshot;
      });

    await expect(
      service.saveMarkdownForAgent(PROJECT_ID, researchWorkspace!.bindingId, {
        category: 'project-progress',
        title: 'Concurrent mutation',
        content: '# Intended content\n',
        idempotencyKey: 'concurrent-mutation',
      }),
    ).rejects.toMatchObject({ code: 'research_notes_save_commit_uncertain' });
  });

  it('accepts only category-scoped project-relative Markdown paths in agent receipts', () => {
    const receipt = {
      schemaVersion: 1 as const,
      projectId: PROJECT_ID,
      category: 'experiments' as const,
      path: 'Experiments/Ablation--0123456789abcdef.md',
      created: true,
      contentSha256: 'a'.repeat(64),
      artifactId: '0123456789abcdef',
    };

    expect(ResearchNotesAgentMarkdownReceiptSchema.parse(receipt)).toEqual(receipt);
    for (const path of [
      '/Experiments/Ablation.md',
      'Experiments\\Ablation.md',
      'Experiments/../Papers/Ablation.md',
      'Papers/Ablation.md',
      'Experiments/Ablation\0.md',
      'Experiments/Ablation.txt',
    ]) {
      expect(() => ResearchNotesAgentMarkdownReceiptSchema.parse({ ...receipt, path })).toThrow();
    }
  });

  it('fails closed on stale bindings, changed ownership, NUL input, and oversized content', async () => {
    const { root, service } = await fixture();
    const alpha = await service.current({ projectId: PROJECT_ID });
    const beta = await service.current({ projectId: OTHER_PROJECT_ID });
    const input = {
      category: 'project-progress' as const,
      title: 'Weekly status',
      content: '# Weekly status\n',
      idempotencyKey: 'weekly-status-1',
    };

    await expect(service.saveMarkdownForAgent(PROJECT_ID, beta!.bindingId, input)).rejects.toThrow(
      'vault_grant_stale',
    );
    await expect(
      service.saveMarkdownForAgent(PROJECT_ID, alpha!.bindingId, {
        ...input,
        content: '# Bad\0content\n',
      }),
    ).rejects.toThrow();
    await expect(
      service.saveMarkdownForAgent(PROJECT_ID, alpha!.bindingId, {
        ...input,
        content: 'x'.repeat(1_000_001),
      }),
    ).rejects.toThrow();
    await expect(
      service.saveMarkdownForAgent(PROJECT_ID, alpha!.bindingId, {
        ...input,
        content: '한'.repeat(700_000),
      }),
    ).rejects.toThrow('content_exceeds_markdown_byte_limit');

    const markerPath = join(root, 'GOSU', 'Alpha Project', '.gosu-project.json');
    const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>;
    await writeFile(markerPath, `${JSON.stringify({ ...marker, bindingId: 'f'.repeat(64) })}\n`);
    await expect(service.saveMarkdownForAgent(PROJECT_ID, alpha!.bindingId, input)).rejects.toThrow(
      'research_notes_folder_unavailable',
    );
    await expect(
      readFile(join(root, 'GOSU', 'Alpha Project', 'Project Progress', 'Weekly status.md')),
    ).rejects.toThrow();
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

  it('preserves managed Literature created_at while advancing modified_at', async () => {
    let currentTime = NOW;
    const { root, records, service } = await fixture({ now: () => currentTime });
    await service.current({ projectId: PROJECT_ID });
    const path = join(root, 'GOSU', 'Alpha Project', 'Literature', 'Literature Review.md');
    const first = await readFile(path, 'utf8');

    currentTime = new Date('2026-08-07T00:00:00.000Z');
    records[0] = paper({ version: 2, updatedAt: currentTime.toISOString() });
    await service.syncLiterature(PROJECT_ID);
    const updated = await readFile(path, 'utf8');

    expect(first).toContain(`created_at: ${JSON.stringify(NOW.toISOString())}`);
    expect(updated).toContain(`created_at: ${JSON.stringify(NOW.toISOString())}`);
    expect(updated).toContain(`modified_at: ${JSON.stringify(currentTime.toISOString())}`);
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
    expect(generated).toContain('gosu_schema_version: 2');
    expect(generated).toContain('gosu_creator_id: "gosu-system"');
    expect(generated).toContain('related_documents: ["Literature/Literature Review.md"]');
    expect(generated).toContain('related_papers: ["https://doi.org/10.1000/fixture"]');
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
