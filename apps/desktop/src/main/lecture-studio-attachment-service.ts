import { createHash } from 'node:crypto';

import {
  ChooseLectureStudioAttachmentsInputSchema,
  LECTURE_STUDIO_MAX_ATTACHMENTS,
  LECTURE_STUDIO_MAX_ATTACHMENT_EXTRACTED_CHARACTERS,
  LectureStudioAttachmentCardSchema,
  ReleaseLectureStudioAttachmentInputSchema,
  type ChooseLectureStudioAttachmentsInput,
  type LectureStudioAttachmentCard,
  type ReleaseLectureStudioAttachmentInput,
} from '../shared/lecture-studio-attachment-contracts';
import {
  LectureStudioAttachmentSnapshotSchema,
  LectureStudioSchema,
  type LectureStudio,
  type LectureStudioAttachmentSnapshot,
} from '../shared/lecture-studio-contracts';
import { LECTURE_EXTERNAL_SOURCE_SET_TTL_MS } from '../shared/lecture-external-source-contracts';
import {
  LectureExternalSourceError,
  type LectureExternalSourceService,
} from './lecture-external-source-service';

const MAX_LIVE_STUDIO_ATTACHMENT_SETS = 20;

type AttachmentSetScope = Readonly<{
  projectId: string;
  studioId: string;
  sourceSetId: string;
}>;

export type PreparedLectureStudioAttachments = Readonly<{
  cards: readonly LectureStudioAttachmentCard[];
  snapshots: readonly LectureStudioAttachmentSnapshot[];
  commit(): Promise<void>;
  rollback(): Promise<void>;
}>;

export class LectureStudioAttachmentService {
  private readonly sourceSetByStudio = new Map<string, AttachmentSetScope>();
  private readonly studioMutationTails = new Map<string, Promise<void>>();
  private readonly pendingScopeReservations = new Set<string>();

  constructor(
    private readonly dependencies: Readonly<{
      externalSources: Pick<
        LectureExternalSourceService,
        | 'chooseAndStage'
        | 'listStaged'
        | 'removeStaged'
        | 'discard'
        | 'snapshotStaged'
        | 'consumeStaged'
      >;
      getStudio(studioId: string): Promise<LectureStudio | null> | LectureStudio | null;
      now?: () => Date;
    }>,
  ) {}

  async choose(
    input: ChooseLectureStudioAttachmentsInput,
  ): Promise<readonly LectureStudioAttachmentCard[]> {
    const command = ChooseLectureStudioAttachmentsInputSchema.parse(input);
    return this.withStudioMutation(command.studioId, () => this.chooseSerialized(command));
  }

  private async chooseSerialized(command: ChooseLectureStudioAttachmentsInput) {
    const studio = await this.requireMutableStudio(command.studioId);
    let scope = this.sourceSetByStudio.get(studio.id);
    if (scope && scope.projectId !== studio.outputProjectId) {
      throw new LectureExternalSourceError('lecture_external_source_scope_mismatch');
    }
    let priorSources: Awaited<ReturnType<LectureExternalSourceService['listStaged']>>['sources'] =
      [];
    if (scope) {
      try {
        priorSources = (
          await this.dependencies.externalSources.listStaged({
            projectId: scope.projectId,
            sourceSetId: scope.sourceSetId,
          })
        ).sources;
      } catch (error) {
        if (isNonReusableStagedSet(error)) {
          this.deleteScopeIfCurrent(studio.id, scope.sourceSetId);
        }
        throw error;
      }
    }
    let reservedFreshScope = false;
    if (!scope) {
      await this.pruneUnavailableScopes(studio.id);
      if (
        this.sourceSetByStudio.size + this.pendingScopeReservations.size >=
        MAX_LIVE_STUDIO_ATTACHMENT_SETS
      ) {
        throw new LectureExternalSourceError('lecture_external_source_too_many');
      }
      this.pendingScopeReservations.add(studio.id);
      reservedFreshScope = true;
    }
    const priorSourceIds = new Set(priorSources.map((source) => source.id));
    try {
      const staged: Awaited<ReturnType<LectureExternalSourceService['chooseAndStage']>> =
        await this.dependencies.externalSources.chooseAndStage(
          {
            projectId: studio.outputProjectId,
            sourceSetId: scope?.sourceSetId ?? null,
          },
          {
            maxSources: LECTURE_STUDIO_MAX_ATTACHMENTS,
            maxTotalExtractedCharacters: LECTURE_STUDIO_MAX_ATTACHMENT_EXTRACTED_CHARACTERS,
          },
        );
      const additions = staged.sources.filter((source) => !priorSourceIds.has(source.id));
      if (additions.length === 0) {
        if (!scope) {
          await this.dependencies.externalSources
            .discard({ projectId: studio.outputProjectId, sourceSetId: staged.id })
            .catch(() => undefined);
        }
        return [];
      }
      const afterPicker = await this.dependencies.getStudio(studio.id);
      const remainsEligible =
        afterPicker &&
        !afterPicker.trashedAt &&
        !afterPicker.activeAttemptId &&
        afterPicker.outputProjectId === studio.outputProjectId &&
        afterPicker.version === studio.version &&
        (afterPicker.status === 'ready' ||
          (afterPicker.status === 'failed' && afterPicker.currentRevision > 0));
      if (!remainsEligible) {
        if (!scope) {
          await this.dependencies.externalSources
            .discard({ projectId: studio.outputProjectId, sourceSetId: staged.id })
            .catch(() => undefined);
        } else {
          await Promise.all(
            additions.map((source) =>
              this.dependencies.externalSources
                .removeStaged({
                  projectId: scope!.projectId,
                  sourceSetId: scope!.sourceSetId,
                  sourceId: source.id,
                })
                .catch(() => undefined),
            ),
          );
        }
        throw new LectureExternalSourceError('lecture_external_source_scope_mismatch');
      }
      scope ??= {
        projectId: studio.outputProjectId,
        studioId: studio.id,
        sourceSetId: staged.id,
      };
      this.sourceSetByStudio.set(studio.id, scope);
      return additions.map((source) =>
        LectureStudioAttachmentCardSchema.parse({
          id: source.id,
          displayName: source.displayName,
          format: source.kind,
          byteSize: source.byteSize,
          sha256: source.sourceSha256,
          unitLabel: source.extraction.unitLabel,
          unitCount: source.extraction.unitCount,
          extractedCharacters: source.extraction.extractedCharacters,
          truncated: source.extraction.truncated,
          textAvailable: source.extraction.textAvailable,
          reconstructionNotice: source.extraction.reconstructionNotice,
          expiresAt: staged.expiresAt,
        }),
      );
    } catch (error) {
      if (scope && isNonReusableStagedSet(error)) {
        this.deleteScopeIfCurrent(studio.id, scope.sourceSetId);
      }
      throw error;
    } finally {
      if (reservedFreshScope) this.pendingScopeReservations.delete(studio.id);
    }
  }

  async release(input: ReleaseLectureStudioAttachmentInput): Promise<{ released: true }> {
    const command = ReleaseLectureStudioAttachmentInputSchema.parse(input);
    return this.withStudioMutation(command.studioId, () => this.releaseSerialized(command));
  }

  private async releaseSerialized(command: ReleaseLectureStudioAttachmentInput) {
    const scope = this.sourceSetByStudio.get(command.studioId);
    if (!scope) return { released: true as const };
    const studio = await this.dependencies.getStudio(command.studioId);
    if (studio && scope.projectId !== studio.outputProjectId) {
      throw new LectureExternalSourceError('lecture_external_source_scope_mismatch');
    }
    let next: Awaited<ReturnType<LectureExternalSourceService['removeStaged']>>;
    try {
      next = await this.dependencies.externalSources.removeStaged({
        projectId: scope.projectId,
        sourceSetId: scope.sourceSetId,
        sourceId: command.attachmentId,
      });
    } catch (error) {
      if (
        error instanceof LectureExternalSourceError &&
        error.code === 'lecture_external_source_expired'
      ) {
        this.deleteScopeIfCurrent(command.studioId, scope.sourceSetId);
        return { released: true as const };
      }
      if (
        error instanceof LectureExternalSourceError &&
        error.code === 'lecture_external_source_not_found'
      ) {
        try {
          await this.dependencies.externalSources.listStaged({
            projectId: scope.projectId,
            sourceSetId: scope.sourceSetId,
          });
        } catch (probeError) {
          if (!isUnavailableStagedSet(probeError)) throw probeError;
          this.deleteScopeIfCurrent(command.studioId, scope.sourceSetId);
        }
        return { released: true as const };
      }
      if (
        error instanceof LectureExternalSourceError &&
        error.code === 'lecture_external_source_corrupt'
      ) {
        this.deleteScopeIfCurrent(command.studioId, scope.sourceSetId);
      }
      throw error;
    }
    if (next.sources.length === 0) {
      await this.dependencies.externalSources
        .discard({ projectId: scope.projectId, sourceSetId: scope.sourceSetId })
        .catch(() => undefined);
      this.deleteScopeIfCurrent(command.studioId, scope.sourceSetId);
    }
    return { released: true as const };
  }

  async prepare(
    studio: LectureStudio,
    attachmentIds: readonly string[],
  ): Promise<PreparedLectureStudioAttachments | null> {
    if (attachmentIds.length === 0) return null;
    const current = LectureStudioSchema.parse(studio);
    return this.withStudioMutation(current.id, () =>
      this.prepareSerialized(current, attachmentIds),
    );
  }

  private async prepareSerialized(
    current: LectureStudio,
    attachmentIds: readonly string[],
  ): Promise<PreparedLectureStudioAttachments> {
    if (
      current.activeAttemptId ||
      current.trashedAt ||
      (current.status !== 'ready' && !(current.status === 'failed' && current.currentRevision > 0))
    ) {
      throw new LectureExternalSourceError('lecture_external_source_scope_mismatch');
    }
    const scope = this.sourceSetByStudio.get(current.id);
    if (!scope || scope.projectId !== current.outputProjectId) {
      throw new LectureExternalSourceError('lecture_external_source_expired');
    }
    let sources: Awaited<ReturnType<LectureExternalSourceService['snapshotStaged']>>;
    try {
      sources = await this.dependencies.externalSources.snapshotStaged({
        projectId: scope.projectId,
        sourceSetId: scope.sourceSetId,
        sourceIds: [...attachmentIds],
      });
    } catch (error) {
      if (
        error instanceof LectureExternalSourceError &&
        (error.code === 'lecture_external_source_expired' ||
          error.code === 'lecture_external_source_corrupt')
      ) {
        this.deleteScopeIfCurrent(current.id, scope.sourceSetId);
      } else if (
        error instanceof LectureExternalSourceError &&
        error.code === 'lecture_external_source_not_found'
      ) {
        try {
          await this.dependencies.externalSources.listStaged({
            projectId: scope.projectId,
            sourceSetId: scope.sourceSetId,
          });
        } catch (probeError) {
          if (isUnavailableStagedSet(probeError)) {
            this.deleteScopeIfCurrent(current.id, scope.sourceSetId);
          } else {
            throw probeError;
          }
        }
      }
      throw error;
    }
    const capturedAt = (this.dependencies.now?.() ?? new Date()).toISOString();
    const cards = sources.map((source) =>
      LectureStudioAttachmentCardSchema.parse({
        id: source.id,
        displayName: source.displayName,
        format: source.kind,
        byteSize: source.byteSize,
        sha256: source.sourceSha256,
        unitLabel: source.extraction.unitLabel,
        unitCount: source.extraction.unitCount,
        extractedCharacters: source.extraction.extractedCharacters,
        truncated: source.extraction.truncated,
        textAvailable: source.extraction.textAvailable,
        reconstructionNotice: source.extraction.reconstructionNotice,
        expiresAt: new Date(
          Date.parse(capturedAt) + LECTURE_EXTERNAL_SOURCE_SET_TTL_MS,
        ).toISOString(),
      }),
    );
    const snapshots = sources.map((source, index) =>
      LectureStudioAttachmentSnapshotSchema.parse({
        sourceLabel: `A${index + 1}`,
        attachmentId: source.id,
        projectId: current.outputProjectId,
        studioId: current.id,
        displayName: source.displayName,
        format: source.kind,
        byteSize: source.byteSize,
        sourceSha256: source.sourceSha256,
        unitLabel: source.extraction.unitLabel,
        unitCount: source.extraction.unitCount,
        content: source.extraction.content,
        contentSha256: createHash('sha256').update(source.extraction.content, 'utf8').digest('hex'),
        extractedCharacters: source.extraction.content.length,
        truncated: source.extraction.truncated,
        reconstructionNotice: source.extraction.reconstructionNotice,
        capturedAt,
      }),
    );
    let settled = false;
    return {
      cards,
      snapshots,
      commit: async () => {
        await this.withStudioMutation(current.id, async () => {
          if (settled) return;
          try {
            const result = await this.dependencies.externalSources.consumeStaged({
              projectId: scope.projectId,
              sourceSetId: scope.sourceSetId,
              sourceIds: [...attachmentIds],
            });
            settled = true;
            if (result.remainingSources === 0) {
              this.deleteScopeIfCurrent(current.id, scope.sourceSetId);
            }
          } catch (error) {
            // The revision has already committed. Hide a scope whose cleanup could not be
            // confirmed so future picks cannot accidentally append to an orphaned set; its
            // bounded TTL remains the recovery path for the staged bytes.
            this.deleteScopeIfCurrent(current.id, scope.sourceSetId);
            throw error;
          }
        });
      },
      rollback: async () => {
        settled = true;
      },
    };
  }

  private async requireMutableStudio(studioId: string) {
    const studio = await this.dependencies.getStudio(studioId);
    if (!studio || studio.trashedAt) {
      throw new LectureExternalSourceError('lecture_external_source_scope_mismatch');
    }
    if (
      studio.activeAttemptId ||
      (studio.status !== 'ready' && !(studio.status === 'failed' && studio.currentRevision > 0))
    ) {
      throw new LectureExternalSourceError('lecture_external_source_scope_mismatch');
    }
    return LectureStudioSchema.parse(studio);
  }

  private deleteScopeIfCurrent(studioId: string, sourceSetId: string) {
    if (this.sourceSetByStudio.get(studioId)?.sourceSetId === sourceSetId) {
      this.sourceSetByStudio.delete(studioId);
    }
  }

  private async pruneUnavailableScopes(excludedStudioId: string) {
    for (const [studioId, scope] of [...this.sourceSetByStudio]) {
      if (studioId === excludedStudioId || this.studioMutationTails.has(studioId)) continue;
      const studio = await this.dependencies.getStudio(studioId);
      if (!studio || studio.outputProjectId !== scope.projectId) {
        this.deleteScopeIfCurrent(studioId, scope.sourceSetId);
        continue;
      }
      try {
        await this.dependencies.externalSources.listStaged({
          projectId: scope.projectId,
          sourceSetId: scope.sourceSetId,
        });
      } catch (error) {
        if (!isNonReusableStagedSet(error)) continue;
        this.deleteScopeIfCurrent(studioId, scope.sourceSetId);
      }
    }
  }

  private async withStudioMutation<T>(studioId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.studioMutationTails.get(studioId) ?? Promise.resolve();
    const run = prior.catch(() => undefined).then(operation);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.studioMutationTails.set(studioId, tail);
    try {
      return await run;
    } finally {
      if (this.studioMutationTails.get(studioId) === tail) {
        this.studioMutationTails.delete(studioId);
      }
    }
  }
}

function isUnavailableStagedSet(error: unknown) {
  return (
    error instanceof LectureExternalSourceError &&
    (error.code === 'lecture_external_source_not_found' ||
      error.code === 'lecture_external_source_expired')
  );
}

function isNonReusableStagedSet(error: unknown) {
  return (
    isUnavailableStagedSet(error) ||
    (error instanceof LectureExternalSourceError &&
      error.code === 'lecture_external_source_corrupt')
  );
}
