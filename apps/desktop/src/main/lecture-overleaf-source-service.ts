import {
  ImportLectureOverleafSourceInputSchema,
  LectureOverleafSourceReceiptSchema,
  type ImportLectureOverleafSourceInput,
  type LectureOverleafSourceReceipt,
} from '../shared/lecture-overleaf-source-contracts';
import type {
  ConnectOverleafGitInput,
  CreateManuscriptInput,
  DeleteUnconfiguredManuscriptInput,
  FetchManuscriptCheckpointInput,
  ManuscriptWorkspaceSnapshot,
} from '../shared/manuscript-workspace-contracts';

type ManuscriptWorkflow = Readonly<{
  list(input: { projectId: string }): Promise<ManuscriptWorkspaceSnapshot>;
  create(input: CreateManuscriptInput): Promise<ManuscriptWorkspaceSnapshot>;
  connectOverleafGit(input: ConnectOverleafGitInput): Promise<ManuscriptWorkspaceSnapshot>;
  fetchCheckpoint(input: FetchManuscriptCheckpointInput): Promise<ManuscriptWorkspaceSnapshot>;
  deleteUnconfigured(
    input: DeleteUnconfiguredManuscriptInput,
  ): Promise<ManuscriptWorkspaceSnapshot>;
}>;

export type LectureOverleafSourceErrorCode =
  'lecture_overleaf_source_conflict' | 'lecture_overleaf_source_not_ready';

export class LectureOverleafSourceError extends Error {
  constructor(readonly code: LectureOverleafSourceErrorCode) {
    super(code);
    this.name = 'LectureOverleafSourceError';
  }
}

/**
 * Convenience orchestration over the existing Manuscript boundary. It never reads adapter-private
 * Overleaf rows, Git mirrors, or credentials itself. The immutable checkpoint returned by
 * Manuscript becomes an ordinary captured-manuscript candidate for Lecture Studio.
 */
export class LectureOverleafSourceService {
  private readonly projectTails = new Map<string, Promise<void>>();

  constructor(private readonly manuscripts: ManuscriptWorkflow) {}

  async importOverleaf(
    input: ImportLectureOverleafSourceInput,
  ): Promise<LectureOverleafSourceReceipt> {
    const command = ImportLectureOverleafSourceInputSchema.parse(input);
    return this.exclusive(command.projectId, () => this.importExclusive(command));
  }

  private async importExclusive(
    command: ImportLectureOverleafSourceInput,
  ): Promise<LectureOverleafSourceReceipt> {
    const before = await this.manuscripts.list({ projectId: command.projectId });
    const knownIds = new Set(before.manuscripts.map(({ manuscript }) => manuscript.id));
    let created: ManuscriptWorkspaceSnapshot['manuscripts'][number]['manuscript'] | null = null;
    let bindingCommitted = false;
    try {
      const createdSnapshot = await this.manuscripts.create({
        projectId: command.projectId,
        title: command.title,
        rootDocument: command.rootDocument,
      });
      const additions = createdSnapshot.manuscripts.filter(
        ({ manuscript }) => !knownIds.has(manuscript.id),
      );
      if (additions.length !== 1) {
        throw new LectureOverleafSourceError('lecture_overleaf_source_conflict');
      }
      created = additions[0]!.manuscript;
      const linkedSnapshot = await this.manuscripts.connectOverleafGit({
        projectId: command.projectId,
        manuscriptId: created.id,
        expectedManuscriptVersion: created.version,
        providerId: 'overleaf_git',
        remoteUrl: command.remoteUrl,
        accessToken: command.accessToken,
      });
      const linked = linkedSnapshot.manuscripts.find(
        ({ manuscript }) => manuscript.id === created!.id,
      );
      const connection = linked?.connection;
      if (
        !linked ||
        !connection ||
        !connection.binding.enabled ||
        connection.binding.projectId !== command.projectId ||
        connection.binding.manuscriptId !== created.id ||
        connection.binding.providerId !== 'overleaf_git' ||
        !connection.lastObservedProviderRevision
      ) {
        if (connection?.binding.enabled) bindingCommitted = true;
        throw new LectureOverleafSourceError('lecture_overleaf_source_conflict');
      }
      bindingCommitted = true;
      const capturedSnapshot = await this.manuscripts.fetchCheckpoint({
        projectId: command.projectId,
        manuscriptId: created.id,
        bindingId: connection.binding.bindingId,
        expectedBindingVersion: connection.binding.version,
        expectedProviderRevision: connection.lastObservedProviderRevision,
      });
      const captured = capturedSnapshot.manuscripts.find(
        ({ manuscript }) => manuscript.id === created!.id,
      );
      const checkpoint = captured?.connection?.lastCheckpoint;
      if (
        !captured ||
        !checkpoint ||
        captured.manuscript.projectId !== command.projectId ||
        captured.manuscript.rootDocument !== command.rootDocument ||
        checkpoint.projectId !== command.projectId ||
        checkpoint.manuscriptId !== created.id ||
        checkpoint.bindingId !== connection.binding.bindingId ||
        checkpoint.providerId !== 'overleaf_git' ||
        checkpoint.rootDocument !== command.rootDocument ||
        !checkpoint.providerRevision ||
        checkpoint.providerRevision !== connection.lastObservedProviderRevision
      ) {
        throw new LectureOverleafSourceError('lecture_overleaf_source_not_ready');
      }
      return LectureOverleafSourceReceiptSchema.parse({
        schemaVersion: 1,
        projectId: command.projectId,
        manuscriptId: captured.manuscript.id,
        selection: {
          projectId: command.projectId,
          manuscriptId: captured.manuscript.id,
        },
        candidate: {
          manuscript: captured.manuscript,
          availability: 'ready',
          checkpointId: checkpoint.checkpointId,
          providerRevision: checkpoint.providerRevision,
          observedAt: checkpoint.observedAt,
        },
      });
    } catch (error) {
      // Before a binding exists, this is only a local setup record and is safe to remove. Once
      // connected, preserve the binding, provider provenance, and Keychain reference so the user
      // can repair/capture it from Manuscript instead of losing a recoverable connection.
      if (created && !bindingCommitted) {
        await this.manuscripts
          .deleteUnconfigured({
            projectId: command.projectId,
            manuscriptId: created.id,
            expectedVersion: created.version,
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  private async exclusive<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.projectTails.get(projectId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.projectTails.set(projectId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.projectTails.get(projectId) === tail) this.projectTails.delete(projectId);
    }
  }
}
