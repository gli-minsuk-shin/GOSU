import { createHash, randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';

import type { ModelInvocation } from '@gosu/contracts';
import { zipSync } from 'fflate';

import {
  CancelLectureStudioInputSchema,
  CompileLectureStudioPdfInputSchema,
  CurrentLectureStudioGenerationBriefValueSchema,
  CreateLectureStudioInputSchema,
  DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES,
  ExportLectureStudioArtifactInputSchema,
  GenerateLectureStudioInputSchema,
  EmptyLectureStudioTrashInputSchema,
  EmptyLectureStudioTrashReceiptSchema,
  LECTURE_STUDIO_SOURCE_LIST_SECTION_TITLES,
  LECTURE_STUDIO_MAX_MANUSCRIPT_FILES,
  LECTURE_STUDIO_MAX_MESSAGE_LENGTH,
  LECTURE_STUDIO_OUTPUT_SCHEMA,
  LECTURE_STUDIO_REVISION_PATCH_OUTPUT_SCHEMA,
  LectureSourceCandidatesSchema,
  LectureSourceManifestSchema,
  LectureStudioDetailInputSchema,
  LectureStudioDetailSchema,
  LectureStudioAttemptSchema,
  LectureStudioArtifactActionReceiptSchema,
  LectureStudioEventSchema,
  LectureStudioGenerationOutputSchema,
  LectureStudioRevisionPatchOutputSchema,
  LectureStudioListSnapshotSchema,
  LectureStudioMessageSchema,
  LectureStudioRevisionSchema,
  LectureStudioRevisionV4Schema,
  LectureStudioSchema,
  LectureStudioTurnReceiptSchema,
  ListLectureCandidatesInputSchema,
  ListLectureStudiosInputSchema,
  LectureStudioVersionCommandSchema,
  OpenLectureStudioArtifactInputSchema,
  RevealLectureStudioArtifactInputSchema,
  SendLectureStudioMessageInputSchema,
  UpdateLectureStudioGenerationBriefInputSchema,
  GetLectureStudioEditDraftInputSchema,
  LectureStudioEditDraftSchema,
  SaveLectureStudioManualRevisionInputSchema,
  LectureStudioManualRevisionReceiptSchema,
  normalizeLectureStudioDocumentSectionTitle,
  resolveLectureStudioDocumentFeatures,
  type CancelLectureStudioInput,
  type CompileLectureStudioPdfInput,
  type CreateLectureStudioInput,
  type ExportLectureStudioArtifactInput,
  type GenerateLectureStudioInput,
  type EmptyLectureStudioTrashInput,
  type EmptyLectureStudioTrashReceipt,
  type LectureSourceCandidates,
  type LectureSourceManifest,
  type LectureSourceSelection,
  type LectureStudio,
  type LectureStudioAttempt,
  type LectureStudioAttemptPhase,
  type LectureStudioAttemptValidation,
  type LectureStudioArtifact,
  type LectureStudioArtifactActionReceipt,
  type LectureStudioDetail,
  type LectureStudioDocumentFeatures,
  type LectureStudioDetailInput,
  type LectureStudioEvent,
  type LectureStudioGenerationBrief,
  type LectureGenerationProgressPhase,
  type LectureStudioListSnapshot,
  type LectureStudioMessage,
  type LectureStudioPdfPreview,
  type LectureStudioRevision,
  type LectureStudioRevisionPatchOutput,
  type LectureStudioFigureAsset,
  type LectureStudioEditDraft,
  type GetLectureStudioEditDraftInput,
  type SaveLectureStudioManualRevisionInput,
  type LectureStudioManualRevisionReceipt,
  type LectureStudioSummary,
  type LectureStudioTurnReceipt,
  type LectureStudioAttachmentSnapshot,
  type ListLectureCandidatesInput,
  type ListLectureStudiosInput,
  type LectureStudioVersionCommand,
  type OpenLectureStudioArtifactInput,
  type PendingLectureRevisionArtifacts,
  type RevealLectureStudioArtifactInput,
  type SendLectureStudioMessageInput,
  type UpdateLectureStudioGenerationBriefInput,
} from '../shared/lecture-studio-contracts';
import type {
  ExperimentIdea,
  ExperimentMetricPoint,
} from '../shared/experiment-workspace-contracts';
import type { LiteratureRecord } from '../shared/literature-contracts';
import {
  LectureExternalSourceError,
  type LectureExternalSourceService,
} from './lecture-external-source-service';
import type {
  LectureStudioAttachmentService,
  PreparedLectureStudioAttachments,
} from './lecture-studio-attachment-service';
import type {
  ManuscriptCheckpointFileChunk,
  ManuscriptCheckpointFileList,
  ManuscriptWorkspaceSnapshot,
} from '../shared/manuscript-workspace-contracts';
import type { ProjectRecord, WorkspaceSnapshot } from '../shared/workspace-contracts';
import {
  LECTURE_STUDIO_AUTHORING_POLICY_VERSION,
  LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS,
  LECTURE_STUDIO_RETIRED_TURN_ATTACHMENT_CITATION_MARKER,
  LECTURE_STUDIO_SOURCE_MANIFEST_MAX_CHARACTERS,
  buildLectureStudioPrompt,
  sanitizeLectureStudioCurrentDraftTurnAttachments,
  talkSlideBudget,
} from './lecture-studio-prompt';
import {
  LECTURE_LATEX_VALIDATION_REASON_GUIDANCE,
  LectureLatexSourceError,
  buildLectureLatexDocument,
  countLectureSlidePages,
  findLectureSourceListSections,
  findLectureSourcesUsedSection,
  findLectureFigureAssetIds,
  extractEditableLectureLatexBody,
  normalizeGeneratedLectureLatexBody,
  rehydrateLectureEvidenceAnchors,
  type LectureLatexValidationReason,
  validateLectureLatexBody,
} from './lecture-latex-source';
import { LectureStudioStorageError } from './lecture-studio-storage-error';
import {
  LectureDocumentCompilerError,
  type LectureDocumentCompiler,
} from './lecture-document-compiler';
import { lecturePdfExportBytes, type LectureArtifactPlatform } from './lecture-artifact-platform';
import type { ResolvedLectureRevisionArtifact } from './research-notes-service';
import { CodexRequestError } from './codex-app-server';
import {
  LectureStudioFigureServiceError,
  type LectureStudioFigureService,
  type LectureStudioFigureSnapshot,
  type MaterializedLectureStudioFigures,
} from './lecture-studio-figure-service';
import type { ModelUsageService } from './model-usage-service';

type MaybePromise<T> = T | Promise<T>;
type CodexNotification = Readonly<{ method?: string; params?: unknown }>;

function lectureRevisionSource(revision: LectureStudioRevision, kind: 'lecture-notes' | 'slides') {
  if (revision.schemaVersion !== 1) {
    return kind === 'lecture-notes' ? revision.lectureNotesLatex : revision.slidesLatex;
  }
  return kind === 'lecture-notes' ? revision.lectureNotesMarkdown : revision.slidesMarkdown;
}

function lectureRevisionFormat(revision: LectureStudioRevision) {
  return revision.schemaVersion !== 1 ? ('latex' as const) : ('markdown' as const);
}

const CANONICAL_CONTENT_BEGIN = '\n% GOSU-CONTENT-BEGIN\n';
const CANONICAL_CONTENT_END = '\n% GOSU-CONTENT-END\n';

function canonicalLectureBody(source: string) {
  const start = source.indexOf(CANONICAL_CONTENT_BEGIN);
  if (start < 0) return null;
  const bodyStart = start + CANONICAL_CONTENT_BEGIN.length;
  const end = source.indexOf(CANONICAL_CONTENT_END, bodyStart);
  return end < 0 ? null : source.slice(bodyStart, end);
}

function retiredTurnAttachmentLabels(
  previousRevision: LectureStudioRevision | null,
  currentManifest: LectureSourceManifest,
) {
  if (!previousRevision || previousRevision.sourceManifest.schemaVersion !== 4) return [];
  const currentAttachments =
    currentManifest.schemaVersion === 4 ? currentManifest.turnAttachments : [];
  const binding = (attachment: (typeof currentAttachments)[number]) =>
    JSON.stringify([
      attachment.format,
      attachment.displayName,
      attachment.sourceSha256,
      attachment.contentSha256,
    ]);
  const currentBindingByLabel = new Map(
    currentAttachments.map((attachment) => [attachment.sourceLabel, binding(attachment)]),
  );
  return previousRevision.sourceManifest.turnAttachments
    .filter(
      (attachment) => currentBindingByLabel.get(attachment.sourceLabel) !== binding(attachment),
    )
    .map((attachment) => attachment.sourceLabel);
}

function unchangedDraftRetainsRetiredAttachmentCitation(
  previousRevision: LectureStudioRevision | null,
  retiredLabels: readonly string[],
  notesBody: string,
  slidesBody: string,
) {
  if (!previousRevision || previousRevision.schemaVersion === 1 || retiredLabels.length === 0) {
    return false;
  }
  const previousNotesBody = canonicalLectureBody(
    rehydrateLectureEvidenceAnchors(previousRevision.lectureNotesLatex),
  );
  const previousSlidesBody = canonicalLectureBody(
    rehydrateLectureEvidenceAnchors(previousRevision.slidesLatex),
  );
  const hasRetiredCitation = (body: string) =>
    retiredLabels.some((label) => body.includes(`[${label}]`));
  return (
    (previousNotesBody === notesBody && hasRetiredCitation(notesBody)) ||
    (previousSlidesBody === slidesBody && hasRetiredCitation(slidesBody))
  );
}

export type LectureExperimentMetricTail = Readonly<{
  ideaId: string;
  metricPoints: readonly ExperimentMetricPoint[];
  metricPointTotal: number;
}>;

export interface LectureStudioStorage {
  listLectureStudios(includeTrashed?: boolean): MaybePromise<readonly LectureStudioSummary[]>;
  getLectureStudio(studioId: string): MaybePromise<LectureStudio | null>;
  getLectureStudioDetail(studioId: string): MaybePromise<LectureStudioDetail | null>;
  listLectureStudioMessages(
    studioId: string,
    limit: number,
  ): MaybePromise<readonly LectureStudioMessage[]>;
  listLectureStudioRevisions(
    studioId: string,
    limit: number,
  ): MaybePromise<readonly LectureStudioRevision[]>;
  getCurrentLectureStudioRevision(studioId: string): MaybePromise<LectureStudioRevision | null>;
  getLectureStudioRevision(
    studioId: string,
    revision: number,
  ): MaybePromise<LectureStudioRevision | null>;
  createLectureStudio(studio: LectureStudio): MaybePromise<boolean>;
  updateLectureStudioGenerationBrief(
    studioId: string,
    expectedVersion: number,
    generationBrief: LectureStudio['generationBrief'],
    updatedAt: string,
  ): MaybePromise<LectureStudio | null>;
  beginLectureStudioTurn(
    input: Readonly<{
      studioId: string;
      expectedVersion: number;
      attemptId: string;
      userMessage: LectureStudioMessage | null;
      updatedAt: string;
      generationBrief?: LectureStudioGenerationBrief;
      attempt?: LectureStudioAttempt;
    }>,
  ): MaybePromise<LectureStudio | null>;
  recordLectureStudioAttemptInvocation(
    studioId: string,
    attemptId: string,
    input: ModelInvocation,
  ): MaybePromise<LectureStudioAttempt | null>;
  recordLectureStudioAttemptPhase(
    studioId: string,
    attemptId: string,
    input: LectureStudioAttemptPhase,
  ): MaybePromise<LectureStudioAttempt | null>;
  recordLectureStudioAttemptValidation(
    studioId: string,
    attemptId: string,
    input: LectureStudioAttemptValidation,
  ): MaybePromise<LectureStudioAttempt | null>;
  completeLectureStudioTurn(
    input: Readonly<{
      studio: LectureStudio;
      revision: LectureStudioRevision;
      assistantMessage: LectureStudioMessage;
    }>,
  ): MaybePromise<LectureStudio | null>;
  failLectureStudioTurn(
    input: Readonly<{
      studioId: string;
      attemptId: string;
      errorCode: string;
      messageStatus: 'failed' | 'interrupted';
      updatedAt: string;
    }>,
  ): MaybePromise<LectureStudio | null>;
  setLectureStudioTrashed(
    studioId: string,
    expectedVersion: number,
    trashedAt: string | null,
    updatedAt: string,
  ): MaybePromise<LectureStudio | null>;
  emptyLectureStudioTrash(
    input: EmptyLectureStudioTrashInput,
    completedAt: string,
  ): MaybePromise<EmptyLectureStudioTrashReceipt | null>;
  listLectureStudioFigures(studioId: string): MaybePromise<readonly LectureStudioFigureAsset[]>;
  commitManualLectureStudioRevision(
    input: Readonly<{
      studioId: string;
      expectedVersion: number;
      expectedCurrentRevision: number;
      revision: Extract<LectureStudioRevision, { schemaVersion: 4 }>;
      updatedAt: string;
    }>,
  ): MaybePromise<LectureStudio | null>;
}

export interface LectureStudioSourceStorage {
  listLiteratureRecords(projectId: string): MaybePromise<readonly LiteratureRecord[]>;
  getLiteratureRecordsByIds(
    projectId: string,
    recordIds: readonly string[],
  ): MaybePromise<readonly LiteratureRecord[]>;
  listExperimentIdeas(projectId: string): MaybePromise<readonly ExperimentIdea[]>;
  listExperimentMetricTails(
    input: Readonly<{
      projectId: string;
      ideaIds: readonly string[];
      perIdeaLimit: number;
    }>,
  ): MaybePromise<readonly LectureExperimentMetricTail[]>;
  getExperimentIdea(projectId: string, ideaId: string): MaybePromise<ExperimentIdea | null>;
}

/**
 * Read-only, project-scoped port into the Manuscript module. Lecture never reads manuscript
 * tables or adapter-private mirrors directly; every source body comes from one exact captured
 * checkpoint through the Manuscript service's existing validation boundary.
 */
export interface LectureManuscriptSourcePort {
  list(input: { projectId: string }): Promise<ManuscriptWorkspaceSnapshot>;
  listCheckpointFiles(input: {
    projectId: string;
    manuscriptId: string;
    checkpointId: string;
  }): Promise<ManuscriptCheckpointFileList>;
  readCheckpointFile(input: {
    projectId: string;
    manuscriptId: string;
    checkpointId: string;
    relativePath: string;
    offset?: number;
    maxCharacters?: number;
  }): Promise<ManuscriptCheckpointFileChunk>;
}

export interface LectureStudioWorkspace {
  snapshot(): MaybePromise<WorkspaceSnapshot>;
}

export interface LectureStudioArtifactWriter {
  assertRevisionDestination(outputProjectId: string): MaybePromise<void>;
  saveRevisionArtifacts(
    input: Readonly<{
      outputProjectId: string;
      studioId: string;
      studioTitle: string;
      revision: number;
      attemptId: string;
      sourceManifestSha256: string;
      generationBriefSha256: string;
      authoringPolicyVersion: number;
      authoringPolicySha256: string;
      documentFormat?: 'markdown' | 'latex';
      lectureNotesMarkdown?: string;
      slidesMarkdown?: string;
      lectureNotesLatex?: string;
      slidesLatex?: string;
      createdAt: string;
      invocation?: ModelInvocation;
      figureAssets?: readonly LectureStudioFigureSnapshot[];
      relatedDocuments?: readonly string[];
      relatedPapers?: readonly string[];
    }>,
  ): MaybePromise<readonly [LectureStudioArtifact, LectureStudioArtifact]>;
  confirmRevisionArtifacts(
    input: Parameters<LectureStudioArtifactWriter['saveRevisionArtifacts']>[0],
  ): MaybePromise<void>;
  rollbackRevisionArtifacts(
    input: Parameters<LectureStudioArtifactWriter['saveRevisionArtifacts']>[0],
  ): MaybePromise<void>;
  listPendingRevisionArtifacts(
    requestedLimit?: number,
  ): MaybePromise<readonly PendingLectureRevisionArtifacts[]>;
  confirmPendingRevisionArtifacts(pending: PendingLectureRevisionArtifacts): MaybePromise<void>;
  rollbackPendingRevisionArtifacts(pending: PendingLectureRevisionArtifacts): MaybePromise<void>;
  resolveLectureRevisionArtifact(
    outputProjectId: string,
    artifact: LectureStudioArtifact,
  ): MaybePromise<ResolvedLectureRevisionArtifact>;
}

export interface LectureStudioCodex {
  on: EventEmitter['on'];
  startThread(input: {
    cwd: string;
    modelId: string | null;
    developerInstructions?: string;
    responseVerbosity?: 'low' | 'medium' | 'high' | null;
    dynamicTools?: readonly never[];
    webSearchMode?: 'disabled';
  }): Promise<{ threadId: string }>;
  runTurn(input: {
    threadId: string;
    prompt: string;
    requestedModelId: string | null;
    reasoningOptionId: string | null;
    cwd: string;
    localImagePaths?: readonly string[];
    outputSchema?: Readonly<Record<string, unknown>>;
  }): Promise<{ turnId: string; invocation: ModelInvocation }>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  releaseThread(threadId: string): Promise<void>;
}

export class LectureStudioServiceError extends Error {
  constructor(
    readonly code:
      | 'invalid_lecture_input'
      | 'lecture_unavailable'
      | 'lecture_studio_not_found'
      | 'lecture_version_conflict'
      | 'lecture_source_not_found'
      | 'lecture_source_conflict'
      | 'lecture_context_too_large'
      | 'lecture_research_notes_required'
      | 'lecture_busy'
      | 'lecture_not_active'
      | 'lecture_codex_unavailable'
      | 'lecture_auth_required'
      | 'lecture_generation_timed_out'
      | 'lecture_usage_limit_exceeded'
      | 'lecture_generation_interrupted'
      | 'lecture_generation_failed'
      | 'lecture_invalid_response'
      | 'lecture_invalid_response_json'
      | 'lecture_invalid_response_schema'
      | 'lecture_invalid_latex_grammar'
      | 'lecture_invalid_citation_mapping'
      | 'lecture_invalid_slide_count'
      | 'lecture_persistence_failed'
      | 'lecture_capacity_reached'
      | 'lecture_cancelled'
      | 'lecture_pdf_compiler_unavailable'
      | 'lecture_pdf_compile_failed'
      | 'lecture_pdf_too_large'
      | 'lecture_pdf_invalid'
      | 'lecture_figure_unavailable'
      | 'lecture_figure_invalid'
      | 'lecture_figure_too_large'
      | 'lecture_figure_limit_reached'
      | 'lecture_figure_in_use'
      | 'lecture_figure_model_unsupported'
      | 'lecture_artifact_not_found'
      | 'lecture_artifact_changed'
      | 'lecture_artifact_unavailable'
      | 'lecture_export_failed'
      | 'lecture_open_failed'
      | 'lecture_studio_trashed'
      | 'lecture_studio_not_trashed'
      | 'lecture_trash_empty'
      | 'lecture_trash_changed',
  ) {
    super(code);
    this.name = 'LectureStudioServiceError';
  }
}

type PendingTurn = {
  studioId: string;
  attemptId: string;
  threadId: string;
  turnId: string | null;
  invocation: ModelInvocation | null;
  earlyInvocation: { turnId: string; invocation: ModelInvocation } | null;
  finalText: string | null;
  terminal: boolean;
  nativeImageRejected: boolean;
  markActivity: (() => void) | null;
  disposeTimers: (() => void) | null;
  resolve: (value: LectureTurnResult) => void;
};

type LectureTurnFailureCode =
  | 'lecture_context_too_large'
  | 'lecture_codex_unavailable'
  | 'lecture_auth_required'
  | 'lecture_usage_limit_exceeded'
  | 'lecture_generation_interrupted'
  | 'lecture_generation_failed'
  | 'lecture_figure_model_unsupported';

type LectureTurnResult = Readonly<{
  status: string;
  text: string | null;
  failureCode: LectureTurnFailureCode | null;
}>;

type ActiveExecution = {
  studioId: string;
  attemptId: string;
  startedAt: string;
  progressSequence: number;
  lastActivityProgressAt: number;
  threadId: string | null;
  turnId: string | null;
  cancelRequested: boolean;
  /** True only after the entire generation attempt is settled. */
  terminal: boolean;
  /** Tracks the current provider turn separately so validation/compile progress stays publishable. */
  turnTerminal: boolean;
};

type TurnRequest = Readonly<{
  studioId: string;
  expectedVersion: number;
  requestedModelId: string | null;
  reasoningOptionId: string | null;
  message: string | null;
  attachmentIds: readonly string[];
}>;

const LECTURE_STUDIO_MAX_METRICS_PER_IDEA = 64;
const LECTURE_MANUSCRIPT_FILE_MAX_CHARACTERS = 24_000;
const LECTURE_MANUSCRIPT_FILE_EXTRACT_MAX_CHARACTERS = 72_000;
const LECTURE_MANUSCRIPT_TOTAL_EXTRACT_MAX_JSON_CHARACTERS = 100_000;
const LECTURE_MANUSCRIPT_SOURCE_PATH_PATTERN = /\.(?:bib|tex)$/iu;
const UNSUPPORTED_CITATION_PATTERN = /\[@[^\]]+\]|\\(?:auto|paren|text)?cite\b/iu;
const EVIDENCE_LIKE_CITATION_PATTERN = /\[([A-Za-z]\d+)\]/gu;
const SOURCES_USED_TARGET_SOURCE = String.raw`(?:sources?\s*used|source\s*(?:list|section)|references?\s*(?:list|section)|출처\s*(?:목록|섹션|매핑)|참고\s*문헌)`;
const SOURCES_USED_TARGET_WITH_SUFFIX_SOURCE = String.raw`${SOURCES_USED_TARGET_SOURCE}(?:\s*(?:section|list|mapping|섹션|목록|매핑))?`;
const ENGLISH_SOURCES_USED_TARGET_SOURCE = String.raw`(?:(?:the|a|an)\s+)?(?:final\s+)?(?:visible\s+)?${SOURCES_USED_TARGET_WITH_SUFFIX_SOURCE}`;
const KOREAN_SOURCES_USED_TARGET_SOURCE = String.raw`${SOURCES_USED_TARGET_WITH_SUFFIX_SOURCE}\s*(?:을|를|은|는|이|가)?\s*(?:아예|완전히|통째로|다시)?\s*`;
const SOURCES_USED_REQUIRED_NEGATION_PATTERNS = [
  new RegExp(
    String.raw`(?:do\s+not|don['’]t|never)\s+(?:ever\s+)?(?:remove|delete|omit|exclude|hide|drop|leave\s+out|get\s+rid\s+of)\s+${ENGLISH_SOURCES_USED_TARGET_SOURCE}`,
    'iu',
  ),
  new RegExp(
    String.raw`(?:can|could|would|will)\s+you\s+not\s+(?:remove|delete|omit|exclude|hide|drop|leave\s+out|get\s+rid\s+of)\s+${ENGLISH_SOURCES_USED_TARGET_SOURCE}`,
    'iu',
  ),
  new RegExp(
    String.raw`don['’]t\s+want\s+(?:you\s+)?to\s+(?:remove|delete|omit|exclude|hide|drop|leave\s+out|get\s+rid\s+of)\s+${ENGLISH_SOURCES_USED_TARGET_SOURCE}`,
    'iu',
  ),
  new RegExp(
    String.raw`(?:did\s+not|didn['’]t)\s+(?:(?:ask|want|mean|tell)(?:ed)?\s+(?:you\s+)?to\s+)?(?:remove|delete|omit|hide|drop)\s+${ENGLISH_SOURCES_USED_TARGET_SOURCE}`,
    'iu',
  ),
  new RegExp(
    String.raw`${KOREAN_SOURCES_USED_TARGET_SOURCE}(?:(?:지우|빼|없애)지|(?:삭제|제거)하지)\s*(?:마|말|않)`,
    'iu',
  ),
  new RegExp(
    String.raw`${KOREAN_SOURCES_USED_TARGET_SOURCE}(?:지우|삭제|제거|빼|없애)(?:면|해선)\s*안`,
    'iu',
  ),
  new RegExp(
    String.raw`${KOREAN_SOURCES_USED_TARGET_SOURCE}(?:지우|삭제|제거|빼|없애)(?:고|하길|하고)?\s*싶지\s*않`,
    'iu',
  ),
];
const SOURCES_USED_OMITTED_NEGATION_PATTERNS = [
  new RegExp(
    String.raw`(?:do\s+not|don['’]t|never)\s+(?:ever\s+)?(?:include|add|show|keep|retain|restore|bring\s+back)\s+${ENGLISH_SOURCES_USED_TARGET_SOURCE}`,
    'iu',
  ),
  new RegExp(
    String.raw`(?:do\s+not|don['’]t)\s+(?:want|need)\s+${ENGLISH_SOURCES_USED_TARGET_SOURCE}`,
    'iu',
  ),
  new RegExp(
    String.raw`${KOREAN_SOURCES_USED_TARGET_SOURCE}(?:넣|추가|복원|보여|유지|남겨)지\s*(?:마|말|않)`,
    'iu',
  ),
  new RegExp(
    String.raw`${KOREAN_SOURCES_USED_TARGET_SOURCE}(?:넣|추가|복원|보여|유지|남겨)\s*안\s*(?:해도|해|돼|됨|괜찮)`,
    'iu',
  ),
  new RegExp(
    String.raw`${KOREAN_SOURCES_USED_TARGET_SOURCE}(?:없어도\s*(?:돼|됨|괜찮)|필요\s*없|안\s*(?:넣(?:어)?|추가|보여)도\s*(?:돼|됨|괜찮))`,
    'iu',
  ),
];
const SOURCES_USED_OMITTED_DIRECT_PATTERNS = [
  new RegExp(
    String.raw`^\s*(?:(?:please|kindly)\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:remove|delete|omit|exclude|hide|drop|leave\s+out|get\s+rid\s+of)\s+${ENGLISH_SOURCES_USED_TARGET_SOURCE}`,
    'iu',
  ),
  new RegExp(String.raw`(?:without|no)\s+${ENGLISH_SOURCES_USED_TARGET_SOURCE}`, 'iu'),
  new RegExp(
    String.raw`${ENGLISH_SOURCES_USED_TARGET_SOURCE}\s+(?:should|must|needs?\s+to)\s+be\s+(?:removed|deleted|omitted|hidden|dropped)`,
    'iu',
  ),
  new RegExp(
    String.raw`${KOREAN_SOURCES_USED_TARGET_SOURCE}(?:지워|지우|삭제|제거|빼|없애|생략|제외)`,
    'iu',
  ),
  new RegExp(
    String.raw`${SOURCES_USED_TARGET_WITH_SUFFIX_SOURCE}\s*(?:(?:이\s*)?부분|해당\s*부분)\s*(?:을|를|은|는)?\s*(?:지워|지우|삭제|제거|빼|없애|생략|제외)`,
    'iu',
  ),
  new RegExp(String.raw`${SOURCES_USED_TARGET_WITH_SUFFIX_SOURCE}\s*없이`, 'iu'),
];
const SOURCES_USED_REQUIRED_DIRECT_PATTERNS = [
  new RegExp(
    String.raw`^\s*(?:(?:please|kindly)\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:include|add|restore|show|keep|retain|bring\s+back)\s+${ENGLISH_SOURCES_USED_TARGET_SOURCE}`,
    'iu',
  ),
  new RegExp(
    String.raw`${ENGLISH_SOURCES_USED_TARGET_SOURCE}\s+(?:should|must|needs?\s+to)\s+(?:stay|remain|be\s+(?:included|shown|kept|restored))`,
    'iu',
  ),
  new RegExp(String.raw`${KOREAN_SOURCES_USED_TARGET_SOURCE}(?:남겨|유지|넣|추가|복원|보여)`, 'iu'),
];

const TITLE_SLIDE_TARGET_SOURCE = String.raw`(?:slide\s+title\s+page|title\s+(?:page|slide)|cover\s+slide|제목\s*슬라이드|타이틀\s*슬라이드|표지\s*슬라이드)`;
const EVIDENCE_LABEL_TARGET_SOURCE = String.raw`(?:inline\s+(?:evidence|source|citation)\s+(?:labels?|citations?|markers?)|evidence\s+(?:labels?|citations?|markers?)|(?:source|citation)\s+(?:labels?|markers?)|\[(?:P|E|M|F|A)#?\]\s*(?:labels?|markers?)?|인라인\s*(?:근거|출처|인용)\s*(?:라벨|표시|마커)|(?:근거|출처|인용)\s*(?:라벨|표시|마커))`;

function targetedTogglePatterns(target: string) {
  return {
    enabledNegation: [
      new RegExp(
        String.raw`(?:do\s+not|don['’]t|never)\s+(?:remove|delete|omit|exclude|hide|drop)\s+(?:the\s+)?${target}`,
        'iu',
      ),
      new RegExp(
        String.raw`${target}\s*(?:을|를|은|는)?\s*(?:(?:지우|빼|없애)지|(?:삭제|제거|숨기)하지)\s*(?:마|말|않)`,
        'iu',
      ),
    ],
    disabledNegation: [
      new RegExp(
        String.raw`(?:do\s+not|don['’]t|never)\s+(?:include|add|show|keep|retain|restore|bring\s+back)\s+(?:the\s+)?${target}`,
        'iu',
      ),
      new RegExp(
        String.raw`${target}\s*(?:을|를|은|는)?\s*(?:넣|추가|복원|보여|표시|유지)지\s*(?:마|말|않)`,
        'iu',
      ),
    ],
    disabledDirect: [
      new RegExp(
        String.raw`^\s*(?:(?:please|kindly)\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:remove|delete|omit|exclude|hide|drop|leave\s+out|get\s+rid\s+of)\s+(?:the\s+)?${target}`,
        'iu',
      ),
      new RegExp(String.raw`(?:without|no)\s+(?:the\s+)?${target}`, 'iu'),
      new RegExp(
        String.raw`${target}\s*(?:을|를|은|는)?\s*(?:지워|지우|삭제|제거|빼|없애|생략|제외|숨겨|숨기)`,
        'iu',
      ),
    ],
    enabledDirect: [
      new RegExp(
        String.raw`^\s*(?:(?:please|kindly)\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:include|add|restore|show|keep|retain|bring\s+back)\s+(?:the\s+)?${target}`,
        'iu',
      ),
      new RegExp(
        String.raw`${target}\s*(?:을|를|은|는)?\s*(?:다시\s*)?(?:남겨|유지|넣|추가|복원|보여|표시)`,
        'iu',
      ),
    ],
  } as const;
}

const TITLE_SLIDE_PATTERNS = targetedTogglePatterns(TITLE_SLIDE_TARGET_SOURCE);
const EVIDENCE_LABEL_PATTERNS = targetedTogglePatterns(EVIDENCE_LABEL_TARGET_SOURCE);

type LectureSourcesUsedMode = 'required' | 'omitted';

function matchesAny(value: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function lectureDirectiveClauses(value: string) {
  const normalized = value.normalize('NFC');
  const metaQuestionPattern =
    /(?:what\s+does(?:\s+it|\s+that)?\s+mean|what\s+is\s+that\s+supposed\s+to\s+mean|무슨\s*(?:뜻|이야기)|이게\s*뭐|phrase\s+says|문구)/iu;
  const koreanConditionalQuestionPattern =
    /(?:빼|뺀|없애|없앤|숨기|숨긴|지우|지운|삭제하|삭제한|제거하|제거한|생략하|생략한|제외하|제외한|넣|넣는|추가하|추가한|복원하|복원한|보이|보인|표시하|표시한|유지하|유지한|남기|남긴)(?:으?면|다면|는다면)[^.!?;\n]*(?:어떻게|어떤|뭐|무엇|왜|될까|되나|되나요|돼|문제|확인)/iu;
  const englishHypotheticalPattern = /^\s*(?:what|how)\b/iu;
  const withoutQuotedExplanation = metaQuestionPattern.test(normalized)
    ? normalized.replace(/["'`“‘][^"'`”’]*["'`”’]/gu, ' ')
    : normalized;
  return withoutQuotedExplanation
    .replace(/["“”]/gu, '')
    .split(/[.!?;\n]+|\b(?:but|however|instead|actually)\b|(?:하지만|그런데|대신|아니고)/iu)
    .filter(
      (clause) =>
        !metaQuestionPattern.test(clause) &&
        !koreanConditionalQuestionPattern.test(clause) &&
        !englishHypotheticalPattern.test(clause),
    );
}

function classifyTargetedToggle(
  value: string,
  patterns: ReturnType<typeof targetedTogglePatterns>,
) {
  let enabled: boolean | null = null;
  for (const clause of lectureDirectiveClauses(value)) {
    if (matchesAny(clause, patterns.enabledNegation)) enabled = true;
    else if (matchesAny(clause, patterns.disabledNegation)) enabled = false;
    else if (matchesAny(clause, patterns.disabledDirect)) enabled = false;
    else if (matchesAny(clause, patterns.enabledDirect)) enabled = true;
  }
  return enabled;
}

export function classifyLectureTitleSlideDirective(value: string) {
  return classifyTargetedToggle(value, TITLE_SLIDE_PATTERNS);
}

export function classifyLectureEvidenceLabelDirective(value: string) {
  return classifyTargetedToggle(value, EVIDENCE_LABEL_PATTERNS);
}

function sourcesSectionMapsLabel(section: string, label: string) {
  const pattern = new RegExp(`\\[${label}\\]`, 'gu');
  for (const match of section.matchAll(pattern)) {
    const lineEnd = section.indexOf('\n', match.index + match[0].length);
    const tail = section
      .slice(match.index + match[0].length, lineEnd < 0 ? section.length : lineEnd)
      .replace(/^[\s}\]]+/u, '')
      .trim();
    if (tail.length > 0) return true;
  }
  return false;
}

export function classifyLectureSourcesUsedDirective(value: string): LectureSourcesUsedMode | null {
  let mode: LectureSourcesUsedMode | null = null;
  for (const clause of lectureDirectiveClauses(value)) {
    if (matchesAny(clause, SOURCES_USED_REQUIRED_NEGATION_PATTERNS)) mode = 'required';
    else if (matchesAny(clause, SOURCES_USED_OMITTED_NEGATION_PATTERNS)) mode = 'omitted';
    else if (matchesAny(clause, SOURCES_USED_OMITTED_DIRECT_PATTERNS)) mode = 'omitted';
    else if (matchesAny(clause, SOURCES_USED_REQUIRED_DIRECT_PATTERNS)) mode = 'required';
  }
  return mode;
}

function resolveBaseLectureDocumentFeatures(
  studio: LectureStudio,
  previousRevision: LectureStudioRevision | null,
) {
  if (studio.generationBrief.documentFeatures) {
    return resolveLectureStudioDocumentFeatures(studio.generationBrief.documentFeatures);
  }
  if (
    (previousRevision?.schemaVersion === 3 || previousRevision?.schemaVersion === 4) &&
    previousRevision.generationBriefSnapshot.documentFeatures
  ) {
    return resolveLectureStudioDocumentFeatures(
      previousRevision.generationBriefSnapshot.documentFeatures,
    );
  }
  const includeSourcesUsedSection =
    previousRevision?.schemaVersion !== undefined && previousRevision.schemaVersion !== 1
      ? findLectureSourcesUsedSection(
          rehydrateLectureEvidenceAnchors(previousRevision.lectureNotesLatex),
        ) !== null
      : DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES.includeSourcesUsedSection;
  return {
    ...DEFAULT_LECTURE_STUDIO_DOCUMENT_FEATURES,
    includeSourcesUsedSection,
  };
}

function resolveLectureDocumentFeaturesForTurn(
  studio: LectureStudio,
  previousRevision: LectureStudioRevision | null,
  currentRequest: string | null,
): LectureStudioDocumentFeatures {
  const features = resolveBaseLectureDocumentFeatures(studio, previousRevision);
  if (!currentRequest) return features;
  const includeSlideTitlePage = classifyLectureTitleSlideDirective(currentRequest);
  const showInlineEvidenceLabels = classifyLectureEvidenceLabelDirective(currentRequest);
  const sourcesUsedMode = classifyLectureSourcesUsedDirective(currentRequest);
  return {
    includeSlideTitlePage: includeSlideTitlePage ?? features.includeSlideTitlePage,
    showInlineEvidenceLabels: showInlineEvidenceLabels ?? features.showInlineEvidenceLabels,
    includeSourcesUsedSection:
      sourcesUsedMode === null
        ? features.includeSourcesUsedSection
        : sourcesUsedMode === 'required',
  };
}

const NORMALIZED_LECTURE_SOURCE_LIST_TITLES = new Set(
  LECTURE_STUDIO_SOURCE_LIST_SECTION_TITLES.map((title) =>
    normalizeLectureStudioDocumentSectionTitle(title),
  ),
);
function customLectureContentSectionTitles(
  generationBrief: LectureStudioGenerationBrief,
): readonly string[] {
  return generationBrief.structure.mode === 'custom'
    ? generationBrief.structure.sections.map((section) => section.title)
    : [];
}

function customLectureSourceListAliasTitles(generationBrief: LectureStudioGenerationBrief) {
  return new Set(
    customLectureContentSectionTitles(generationBrief)
      .filter((title) => title.normalize('NFC').trim().toLowerCase() !== 'sources used')
      .map((title) => normalizeLectureStudioDocumentSectionTitle(title))
      .filter((title) => NORMALIZED_LECTURE_SOURCE_LIST_TITLES.has(title)),
  );
}

function assertNoNewLectureSourceListAliasTitles(
  generationBrief: LectureStudioGenerationBrief,
  grandfatheredGenerationBrief?: LectureStudioGenerationBrief,
) {
  const grandfathered = grandfatheredGenerationBrief
    ? customLectureSourceListAliasTitles(grandfatheredGenerationBrief)
    : new Set<string>();
  const proposed = customLectureSourceListAliasTitles(generationBrief);
  if ([...proposed].some((title) => !grandfathered.has(title))) {
    throw new LectureStudioServiceError('invalid_lecture_input');
  }
}

type LectureOutputValidationCategory =
  'response_json' | 'response_schema' | 'latex_grammar' | 'citation_mapping' | 'slide_count';

type LectureOutputLatexDiagnostic = Readonly<{
  document: 'lecture-notes' | 'slides';
  reason: LectureLatexValidationReason;
  tokens: readonly string[];
}>;

const LECTURE_OUTPUT_VALIDATION_ERROR_CODES = {
  response_json: 'lecture_invalid_response_json',
  response_schema: 'lecture_invalid_response_schema',
  latex_grammar: 'lecture_invalid_latex_grammar',
  citation_mapping: 'lecture_invalid_citation_mapping',
  slide_count: 'lecture_invalid_slide_count',
} as const satisfies Record<LectureOutputValidationCategory, LectureStudioServiceError['code']>;

class LectureOutputValidationError extends Error {
  readonly code: LectureStudioServiceError['code'];

  constructor(
    readonly category: LectureOutputValidationCategory,
    readonly latexDiagnostics: readonly LectureOutputLatexDiagnostic[] = [],
  ) {
    super(category);
    this.name = 'LectureOutputValidationError';
    this.code = LECTURE_OUTPUT_VALIDATION_ERROR_CODES[category];
  }
}

const LECTURE_OUTPUT_CORRECTION_GUIDANCE = {
  response_json:
    'Return only one JSON object matching the supplied output schema. Do not add a Markdown fence or explanatory text outside the object.',
  response_schema:
    'Return exactly reply, lectureNotesLatexBody, and slidesLatexBody as non-empty strings, with no additional fields.',
  latex_grammar:
    'Regenerate both complete bodies using only the bounded LaTeX dialect and escaping rules in the developer instructions. Do not emit wrappers, comments, raw special characters, custom commands, or unsupported environments.',
  citation_mapping:
    'Regenerate both complete raw bodies so every factual claim and content frame uses only allowed source labels. GOSU validates these anchors before applying their visible or hidden rendering. If the notes include a Sources used section, map every cited label there.',
  slide_count:
    'Regenerate the complete pair with the required content-frame count. GOSU applies the frozen title-page option to the final PDF page count.',
} as const satisfies Record<LectureOutputValidationCategory, string>;

function correctionPrompt(
  error: LectureOutputValidationError,
  studio: LectureStudio,
  documentFeatures: LectureStudioDocumentFeatures,
  outputMode: 'complete' | 'patch',
) {
  const { category } = error;
  const correctionGuidance =
    outputMode === 'patch'
      ? {
          response_json:
            'Return only one JSON object matching the revision-patch output schema, with no Markdown fence or text outside it.',
          response_schema:
            'Return exactly reply and edits. Each edit requires document, find, and replace, with no additional fields.',
          latex_grammar:
            'Correct the localized replacements using only the bounded LaTeX dialect and escaping rules in the developer instructions.',
          citation_mapping:
            'Correct the localized edits so the complete resulting notes and slides retain allowed evidence labels, frame evidence, and the configured source-list state.',
          slide_count:
            'Correct only the frame blocks needed to satisfy the required content-frame count.',
        }[category]
      : LECTURE_OUTPUT_CORRECTION_GUIDANCE[category];
  let slideCountGuidance = '';
  if (category === 'slide_count') {
    const requestedPages = studio.generationBrief.slidesTargetPages;
    const titlePageOffset = documentFeatures.includeSlideTitlePage ? 1 : 0;
    if (requestedPages !== null) {
      const contentFrames = requestedPages - titlePageOffset;
      slideCountGuidance = ` Emit exactly ${contentFrames} content frame${contentFrames === 1 ? '' : 's'}; GOSU ${titlePageOffset === 1 ? 'adds one title frame' : 'does not add a title frame'} for exactly ${requestedPages} PDF page${requestedPages === 1 ? '' : 's'}.`;
    } else if (studio.kind === 'talk') {
      const budget = talkSlideBudget(studio.durationMinutes!);
      slideCountGuidance = ` Emit between ${budget.minimum - titlePageOffset} and ${budget.maximum - titlePageOffset} content frames; GOSU ${titlePageOffset === 1 ? 'adds one title frame' : 'does not add a title frame'} for ${budget.minimum}-${budget.maximum} PDF pages.`;
    }
  }
  const latexGuidance =
    category === 'latex_grammar' && error.latexDiagnostics.length > 0
      ? ` Bounded validator diagnostics: ${error.latexDiagnostics
          .slice(0, 2)
          .map((diagnostic) => {
            const tokenExamples =
              diagnostic.tokens.length > 0
                ? ` Offending token examples: ${diagnostic.tokens.join(', ')}.`
                : '';
            return `${diagnostic.document}: ${diagnostic.reason}. ${LECTURE_LATEX_VALIDATION_REASON_GUIDANCE[diagnostic.reason]}${tokenExamples}`;
          })
          .join(
            ' ',
          )} These diagnostics contain no candidate text and are bounded examples; scan both complete bodies for every occurrence and every other violation, not only the listed examples.`
      : '';
  const sourcesUsedGuidance = !documentFeatures.includeSourcesUsedSection
    ? ' Omit the Sources used section completely while retaining every allowed raw inline source label.'
    : ' Finish the notes with a complete Sources used mapping for every cited label.';
  const evidenceGuidance = documentFeatures.showInlineEvidenceLabels
    ? ' GOSU will render the validated evidence anchors visibly. Put consecutive labels next to each other with whitespace only; never wrap them or join them with punctuation or connector words.'
    : ' GOSU will hide the validated evidence anchors later; keep their raw [P#], [E#], [M#], [F#], or [A#] labels in the returned bodies. Put consecutive labels next to each other with whitespace only; never wrap them or join them with punctuation or connector words.';
  const outputGuidance =
    outputMode === 'patch'
      ? ' Return exactly reply and edits. Every edit must target one exact unique substring from the original currentDraft supplied at the start of this thread; return only the smallest corrected edits and never resend a complete body.'
      : ' Return one complete replacement JSON object now.';
  return `The previous candidate was rejected by GOSU's bounded ${category} check and was not saved. ${correctionGuidance}${sourcesUsedGuidance}${evidenceGuidance}${slideCountGuidance}${latexGuidance}${outputGuidance}`;
}

type LectureStudioRevisionDraftBodies = Readonly<{
  lectureNotes: string;
  slides: string;
}>;

export function applyLectureStudioRevisionPatch(
  currentDraft: LectureStudioRevisionDraftBodies,
  output: LectureStudioRevisionPatchOutput,
) {
  const bodies = {
    lectureNotes: currentDraft.lectureNotes,
    slides: currentDraft.slides,
  };
  const originalLengths = {
    lectureNotes: currentDraft.lectureNotes.length,
    slides: currentDraft.slides.length,
  };
  const affectedCharacters = { lectureNotes: 0, slides: 0 };
  for (const edit of output.edits) {
    const key = edit.document === 'lecture-notes' ? 'lectureNotes' : 'slides';
    const body = bodies[key];
    if (edit.find === edit.replace) throw new Error('lecture_revision_patch_noop');
    const first = body.indexOf(edit.find);
    if (first < 0) throw new Error('lecture_revision_patch_missing_match');
    if (body.indexOf(edit.find, first + edit.find.length) >= 0) {
      throw new Error('lecture_revision_patch_ambiguous_match');
    }
    affectedCharacters[key] += Math.max(edit.find.length, edit.replace.length);
    if (
      originalLengths[key] > 4_000 &&
      affectedCharacters[key] >= Math.floor(originalLengths[key] * 0.8)
    ) {
      throw new Error('lecture_revision_patch_not_localized');
    }
    bodies[key] = `${body.slice(0, first)}${edit.replace}${body.slice(first + edit.find.length)}`;
  }
  return bodies;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lectureErrorFromCodexRequest(error: unknown) {
  if (
    error instanceof Error &&
    (error.message === 'attachment_model_modality_unsupported' ||
      error.message === 'codex_image_modality_unsupported')
  ) {
    return 'lecture_figure_model_unsupported' as const;
  }
  if (!(error instanceof CodexRequestError)) return 'lecture_codex_unavailable' as const;
  switch (error.code) {
    case 'codex_auth_required':
      return 'lecture_auth_required' as const;
    case 'codex_usage_limit_exceeded':
      return 'lecture_usage_limit_exceeded' as const;
    case 'codex_context_too_large':
      return 'lecture_context_too_large' as const;
    case 'codex_request_interrupted':
      return 'lecture_generation_interrupted' as const;
    case 'codex_request_failed':
      return 'lecture_generation_failed' as const;
  }
}

function lectureErrorFromFigureService(error: unknown) {
  if (!(error instanceof LectureStudioFigureServiceError)) {
    return new LectureStudioServiceError('lecture_figure_unavailable');
  }
  switch (error.code) {
    case 'figure_invalid':
    case 'figure_unsupported':
    case 'figure_extraction_failed':
      return new LectureStudioServiceError('lecture_figure_invalid');
    case 'figure_too_large':
    case 'figure_total_too_large':
      return new LectureStudioServiceError('lecture_figure_too_large');
    case 'figure_too_many':
      return new LectureStudioServiceError('lecture_figure_limit_reached');
    case 'figure_version_conflict':
      return new LectureStudioServiceError('lecture_version_conflict');
    case 'figure_studio_not_found':
      return new LectureStudioServiceError('lecture_studio_not_found');
    case 'figure_in_use':
      return new LectureStudioServiceError('lecture_figure_in_use');
    case 'figure_scope_unavailable':
    case 'figure_not_found':
    case 'figure_storage_failed':
      return new LectureStudioServiceError('lecture_figure_unavailable');
  }
}

/**
 * Convert Codex's structured terminal reason to a stable, non-sensitive application error.
 * Raw provider messages and additionalDetails can contain request context, so they must never
 * cross the main-process boundary or be written to the Lecture Studio record.
 */
function classifyCodexTurnFailure(turn: unknown): LectureTurnFailureCode {
  if (!isRecord(turn) || !isRecord(turn.error)) return 'lecture_generation_failed';
  const info = turn.error.codexErrorInfo;
  const kind =
    typeof info === 'string'
      ? info
      : isRecord(info)
        ? (Object.keys(info).find((key) => Object.hasOwn(info, key)) ?? null)
        : null;

  switch (kind) {
    case 'contextWindowExceeded':
    case 'sessionBudgetExceeded':
      return 'lecture_context_too_large';
    case 'usageLimitExceeded':
      return 'lecture_usage_limit_exceeded';
    case 'serverOverloaded':
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
    case 'responseTooManyFailedAttempts':
    case 'internalServerError':
      return 'lecture_generation_interrupted';
    case 'unauthorized':
      return 'lecture_auth_required';
    default:
      return 'lecture_generation_failed';
  }
}

function notificationIdentity(notification: CodexNotification) {
  if (!isRecord(notification.params) || typeof notification.params.threadId !== 'string') {
    return null;
  }
  const turn = notification.params.turn;
  const turnId =
    typeof notification.params.turnId === 'string'
      ? notification.params.turnId
      : isRecord(turn) && typeof turn.id === 'string'
        ? turn.id
        : null;
  return turnId ? { threadId: notification.params.threadId, turnId } : null;
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sourceManifestWithTurnAttachments(
  base: LectureSourceManifest,
  attachments: readonly LectureStudioAttachmentSnapshot[],
) {
  if (attachments.length === 0) return base;
  const manuscripts = base.schemaVersion === 1 ? [] : base.manuscripts;
  const externalSources =
    base.schemaVersion === 3 || base.schemaVersion === 4 ? base.externalSources : [];
  const build = (perAttachmentCharacters: number) =>
    LectureSourceManifestSchema.parse({
      schemaVersion: 4,
      selectedProjectIds: base.selectedProjectIds,
      literature: base.literature,
      experiments: base.experiments,
      manuscripts,
      externalSources,
      turnAttachments: attachments.map((attachment) => {
        const content = safeCharacterSlice(
          attachment.content,
          0,
          Math.min(attachment.content.length, Math.max(2, perAttachmentCharacters)),
        );
        return {
          ...attachment,
          content,
          contentSha256: sha256(content),
          extractedCharacters: content.length,
          truncated: attachment.truncated || content.length < attachment.content.length,
        };
      }),
    });
  const maximum = Math.max(...attachments.map((attachment) => attachment.content.length));
  const complete = build(maximum);
  if (JSON.stringify(complete).length <= LECTURE_STUDIO_SOURCE_MANIFEST_MAX_CHARACTERS) {
    return complete;
  }
  let low = 1;
  let high = maximum;
  let accepted: LectureSourceManifest | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = build(middle);
    if (JSON.stringify(candidate).length <= LECTURE_STUDIO_SOURCE_MANIFEST_MAX_CHARACTERS) {
      accepted = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (!accepted) throw new LectureStudioServiceError('lecture_context_too_large');
  return accepted;
}

function safeCharacterSlice(value: string, start: number, end?: number) {
  let safeStart = Math.max(0, Math.min(start, value.length));
  let safeEnd = Math.max(safeStart, Math.min(end ?? value.length, value.length));
  const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;
  const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
  if (safeStart > 0 && isLowSurrogate(value.charCodeAt(safeStart))) safeStart -= 1;
  if (safeEnd < value.length && isHighSurrogate(value.charCodeAt(safeEnd - 1))) safeEnd -= 1;
  return value.slice(safeStart, safeEnd);
}

function boundedExactFileExtract(content: string, maximumCharacters: number) {
  if (content.length <= maximumCharacters) return content;
  const marker = '\n\n% [GOSU bounded exact checkpoint extract: middle omitted]\n\n';
  const bodyBudget = Math.max(2, maximumCharacters - marker.length);
  const prefixLength = Math.ceil(bodyBudget * 0.72);
  const suffixLength = bodyBudget - prefixLength;
  return `${safeCharacterSlice(content, 0, prefixLength)}${marker}${safeCharacterSlice(
    content,
    content.length - suffixLength,
  )}`;
}

function boundedExactFileExtractToJsonBudget(content: string, maximumJsonCharacters: number) {
  if (JSON.stringify(content).length <= maximumJsonCharacters) return content;
  // An incomplete prefix/suffix extract carries a provenance marker. For very small residual
  // budgets the marker itself cannot fit, so retain the file identity/hash with an empty exact
  // excerpt instead of silently exceeding the caller's serialized-context allowance.
  if (JSON.stringify(boundedExactFileExtract(content, 1)).length > maximumJsonCharacters) return '';
  let low = 1;
  let high = Math.min(content.length, maximumJsonCharacters);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = boundedExactFileExtract(content, middle);
    if (JSON.stringify(candidate).length <= maximumJsonCharacters) low = middle;
    else high = middle - 1;
  }
  return boundedExactFileExtract(content, low);
}

function uniqueNonEmpty(values: readonly string[], maximum: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length === maximum) break;
  }
  return result;
}

function canonicalDoiUrl(doi: string | null) {
  if (!doi) return null;
  try {
    const normalized = doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, '');
    const result = new URL(`https://doi.org/${normalized}`);
    return result.origin === 'https://doi.org' && result.username === '' && result.password === ''
      ? result.toString()
      : null;
  } catch {
    return null;
  }
}

function assistantContent(reply: string, artifacts: readonly LectureStudioArtifact[]) {
  const suffix = `\n\nSaved to Research Notes:\n${artifacts
    .map((artifact) => `- ${artifact.relativePath}`)
    .join('\n')}`;
  const maximumReplyLength = Math.max(1, LECTURE_STUDIO_MAX_MESSAGE_LENGTH - suffix.length);
  return `${reply.slice(0, maximumReplyLength).trimEnd()}${suffix}`;
}

function pendingArtifactPath(
  pending: PendingLectureRevisionArtifacts,
  artifact: LectureStudioArtifact,
) {
  return pending.artifacts.some(
    (candidate) =>
      candidate.kind === artifact.kind && candidate.relativePath === artifact.relativePath,
  );
}

function committedRevisionMatchesPending(
  studio: LectureStudio,
  revision: LectureStudioRevision,
  pending: PendingLectureRevisionArtifacts,
) {
  if (
    studio.id !== pending.studioId ||
    studio.outputProjectId !== pending.outputProjectId ||
    studio.currentRevision < pending.revision ||
    revision.studioId !== pending.studioId ||
    revision.revision !== pending.revision ||
    revision.attemptId !== pending.attemptId ||
    revision.sourceManifestSha256 !== pending.sourceManifestSha256
  ) {
    return false;
  }
  const pendingHasGenerationProvenance =
    pending.generationBriefSha256 !== undefined ||
    pending.authoringPolicyVersion !== undefined ||
    pending.authoringPolicySha256 !== undefined;
  if (revision.schemaVersion === 3 || revision.schemaVersion === 4) {
    if (
      pending.generationBriefSha256 !== revision.generationBriefSha256 ||
      pending.authoringPolicyVersion !== revision.authoringPolicyVersion ||
      pending.authoringPolicySha256 !== revision.authoringPolicySha256
    ) {
      return false;
    }
  } else if (pendingHasGenerationProvenance) {
    return false;
  }
  const pendingFigureAssets = pending.figureAssets ?? [];
  if (
    revision.schemaVersion === 4
      ? JSON.stringify(revision.figureAssets) !== JSON.stringify(pendingFigureAssets)
      : pendingFigureAssets.length > 0
  ) {
    return false;
  }
  return (
    revision.artifacts.length === pending.artifacts.length &&
    revision.artifacts.every((artifact) =>
      pending.artifacts.some(
        (candidate) =>
          candidate.kind === artifact.kind &&
          candidate.relativePath === artifact.relativePath &&
          candidate.contentSha256 === artifact.contentSha256,
      ),
    )
  );
}

export class LectureStudioService {
  private readonly pendingByThread = new Map<string, PendingTurn>();
  private readonly bufferedByThread = new Map<string, CodexNotification[]>();
  private readonly activeByStudio = new Map<string, ActiveExecution>();
  private readonly manualSaveByStudio = new Set<string>();
  private readonly lifecycleLockedProjects = new Set<string>();
  private readonly listeners = new Set<(event: LectureStudioEvent) => void>();
  private pendingArtifactReconciliation: Promise<void> | null = null;

  constructor(
    private readonly dependencies: Readonly<{
      storage: LectureStudioStorage;
      sources: LectureStudioSourceStorage;
      manuscripts: LectureManuscriptSourcePort;
      externalSources: Pick<
        LectureExternalSourceService,
        'claim' | 'discard' | 'snapshots' | 'purgeStudio' | 'rollbackClaim'
      >;
      attachments?: Pick<LectureStudioAttachmentService, 'prepare'>;
      figures?: Pick<
        LectureStudioFigureService,
        'list' | 'snapshotFigures' | 'snapshotRevisionFigures' | 'materializeActiveFigures'
      >;
      workspace: LectureStudioWorkspace;
      artifacts: LectureStudioArtifactWriter;
      codex: LectureStudioCodex;
      usage?: Pick<ModelUsageService, 'bindThread' | 'releaseThread'>;
      /** Required acceptance gate: no canonical LaTeX revision is published before both PDFs compile. */
      pdfCompiler: Pick<LectureDocumentCompiler, 'compile'>;
      artifactPlatform?: LectureArtifactPlatform;
      prepareDirectory: (outputProjectId: string) => Promise<string>;
      now?: () => Date;
      /** Maximum time without a matching Codex notification before generation is stopped. */
      timeoutMs?: number;
      /** Absolute deadline for one generation, even while Codex continues reporting progress. */
      hardTimeoutMs?: number;
    }>,
  ) {
    dependencies.codex.on('notification', (notification: CodexNotification) => {
      this.routeNotification(notification);
    });
    dependencies.codex.on('disconnected', () => {
      for (const pending of this.pendingByThread.values()) {
        if (pending.terminal) continue;
        pending.terminal = true;
        const bufferedNativeImageRejection = (
          this.bufferedByThread.get(pending.threadId) ?? []
        ).some((notification) => notification.method === 'gosu/attachment-model-modality-rejected');
        pending.resolve({
          status: 'transport_failed',
          text: null,
          failureCode:
            pending.nativeImageRejected || bufferedNativeImageRejection
              ? 'lecture_figure_model_unsupported'
              : null,
        });
      }
    });
    dependencies.codex.on(
      'invocation',
      (event: { threadId?: string; turnId?: string; invocation?: ModelInvocation }) => {
        if (!event.threadId || !event.turnId || !event.invocation) return;
        const pending = this.pendingByThread.get(event.threadId);
        if (!pending) return;
        if (pending.turnId === null) {
          pending.earlyInvocation = { turnId: event.turnId, invocation: event.invocation };
          return;
        }
        if (pending.turnId === event.turnId) {
          pending.invocation = event.invocation;
          pending.markActivity?.();
        }
      },
    );
  }

  onEvent(listener: (event: LectureStudioEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async list(input: ListLectureStudiosInput): Promise<LectureStudioListSnapshot> {
    const command = ListLectureStudiosInputSchema.parse(input);
    await this.reconcilePendingArtifacts().catch(() => undefined);
    const studios = await this.dependencies.storage.listLectureStudios(command.includeTrashed);
    return LectureStudioListSnapshotSchema.parse({ schemaVersion: 1, studios });
  }

  async detail(input: LectureStudioDetailInput): Promise<LectureStudioDetail> {
    const command = LectureStudioDetailInputSchema.parse(input);
    await this.reconcilePendingArtifacts().catch(() => undefined);
    const detail = await this.dependencies.storage.getLectureStudioDetail(command.studioId);
    if (!detail) throw new LectureStudioServiceError('lecture_studio_not_found');
    if (detail.studio.trashedAt) {
      throw new LectureStudioServiceError('lecture_studio_trashed');
    }
    return LectureStudioDetailSchema.parse(detail);
  }

  async candidates(input: ListLectureCandidatesInput): Promise<LectureSourceCandidates> {
    const command = ListLectureCandidatesInputSchema.parse(input);
    const projects = await this.requireActiveProjects(command.projectIds);
    const candidates = await Promise.all(
      projects.map(async (project) => {
        const [literatureRecords, ideas, manuscriptSnapshot] = await Promise.all([
          this.dependencies.sources.listLiteratureRecords(project.id),
          this.dependencies.sources.listExperimentIdeas(project.id),
          this.dependencies.manuscripts.list({ projectId: project.id }),
        ]);
        if (manuscriptSnapshot.projectId !== project.id) {
          throw new LectureStudioServiceError('lecture_source_conflict');
        }
        const eligibleLiterature = literatureRecords.filter(
          (record) =>
            record.reviewStatus !== 'excluded' &&
            (command.includeUnreviewed ||
              record.reviewStatus === 'included' ||
              record.reviewStatus === 'reviewed'),
        );
        const orderedLiterature = eligibleLiterature.sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
        );
        const orderedIdeas = [...ideas].sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        );
        const pageIdeas = orderedIdeas.slice(
          command.experimentOffset,
          command.experimentOffset + command.experimentLimit,
        );
        const metricTails =
          pageIdeas.length > 0
            ? await this.dependencies.sources.listExperimentMetricTails({
                projectId: project.id,
                ideaIds: pageIdeas.map((idea) => idea.id),
                perIdeaLimit: command.metricPointLimit,
              })
            : [];
        const requestedIdeaIds = new Set(pageIdeas.map((idea) => idea.id));
        const tailsByIdea = new Map<string, LectureExperimentMetricTail>();
        for (const tail of metricTails) {
          if (
            !requestedIdeaIds.has(tail.ideaId) ||
            tailsByIdea.has(tail.ideaId) ||
            tail.metricPoints.length > command.metricPointLimit ||
            tail.metricPointTotal < tail.metricPoints.length ||
            tail.metricPoints.some(
              (point) => point.projectId !== project.id || point.ideaId !== tail.ideaId,
            )
          ) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          tailsByIdea.set(tail.ideaId, tail);
        }
        return {
          projectId: project.id,
          projectName: project.name,
          literatureRecords: orderedLiterature.slice(
            command.literatureOffset,
            command.literatureOffset + command.literatureLimit,
          ),
          literaturePage: {
            offset: command.literatureOffset,
            limit: command.literatureLimit,
            total: orderedLiterature.length,
            hasMore: command.literatureOffset + command.literatureLimit < orderedLiterature.length,
          },
          experiments: pageIdeas.map((idea) => {
            const tail = tailsByIdea.get(idea.id);
            const metricPoints = [...(tail?.metricPoints ?? [])].sort(
              (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
            );
            const metricPointTotal = tail?.metricPointTotal ?? 0;
            return {
              idea,
              metricPoints,
              metricPointTotal,
              metricsTruncated: metricPointTotal > metricPoints.length,
            };
          }),
          experimentPage: {
            offset: command.experimentOffset,
            limit: command.experimentLimit,
            total: orderedIdeas.length,
            hasMore: command.experimentOffset + command.experimentLimit < orderedIdeas.length,
          },
          manuscripts: manuscriptSnapshot.manuscripts.map(({ manuscript, connection }) => {
            if (manuscript.projectId !== project.id) {
              throw new LectureStudioServiceError('lecture_source_conflict');
            }
            const linked =
              connection?.binding.enabled === true &&
              connection.binding.projectId === project.id &&
              connection.binding.manuscriptId === manuscript.id;
            const checkpoint =
              linked &&
              connection.lastCheckpoint?.bindingId === connection.binding.bindingId &&
              connection.lastCheckpoint.projectId === project.id &&
              connection.lastCheckpoint.manuscriptId === manuscript.id &&
              connection.lastCheckpoint.providerId === connection.binding.providerId &&
              connection.lastCheckpoint.rootDocument === manuscript.rootDocument
                ? connection.lastCheckpoint
                : null;
            return {
              manuscript,
              availability: checkpoint
                ? ('ready' as const)
                : linked
                  ? ('capture_required' as const)
                  : ('unconnected' as const),
              checkpointId: checkpoint?.checkpointId ?? null,
              providerRevision: checkpoint?.providerRevision ?? checkpoint?.sourceRevision ?? null,
              observedAt: checkpoint?.observedAt ?? null,
            };
          }),
        };
      }),
    );
    return LectureSourceCandidatesSchema.parse({ schemaVersion: 1, projects: candidates });
  }

  async reconcilePendingArtifacts() {
    if (this.pendingArtifactReconciliation) {
      await this.pendingArtifactReconciliation;
      return;
    }
    const running = this.reconcilePendingArtifactsOnce();
    this.pendingArtifactReconciliation = running;
    try {
      await running;
    } finally {
      if (this.pendingArtifactReconciliation === running) {
        this.pendingArtifactReconciliation = null;
      }
    }
  }

  async create(input: CreateLectureStudioInput): Promise<LectureStudio> {
    const command = CreateLectureStudioInputSchema.parse(input);
    const generationBrief = CurrentLectureStudioGenerationBriefValueSchema.parse({
      ...command.generationBrief,
      documentFeatures: resolveLectureStudioDocumentFeatures(
        command.generationBrief.documentFeatures,
      ),
    });
    assertNoNewLectureSourceListAliasTitles(generationBrief);
    this.throwIfProjectsLifecycleLocked([...command.sourceProjectIds, command.outputProjectId]);
    const studioId = randomUUID();
    const externalSelection = command.sourceSelection.externalSources;
    let claimedExternalSources = false;
    if (externalSelection) {
      if (!command.sourceProjectIds.includes(command.outputProjectId)) {
        throw new LectureStudioServiceError('lecture_source_conflict');
      }
      try {
        await this.dependencies.externalSources.claim({
          projectId: command.outputProjectId,
          studioId,
          sourceSetId: externalSelection.sourceSetId,
          selectedSourceIds: externalSelection.sourceIds,
        });
        claimedExternalSources = true;
      } catch {
        throw new LectureStudioServiceError('lecture_source_conflict');
      }
    }
    try {
      await this.resolveSourceManifest(
        command.sourceProjectIds,
        command.sourceSelection,
        studioId,
        command.outputProjectId,
      );
      this.throwIfProjectsLifecycleLocked([...command.sourceProjectIds, command.outputProjectId]);
    } catch (error) {
      if (claimedExternalSources) {
        await this.dependencies.externalSources
          .rollbackClaim({ projectId: command.outputProjectId, studioId })
          .catch(() => undefined);
      }
      throw error;
    }
    const now = this.now().toISOString();
    const studio = LectureStudioSchema.parse({
      schemaVersion: 1,
      id: studioId,
      ...command,
      generationBrief,
      status: 'draft',
      activeAttemptId: null,
      currentRevision: 0,
      version: 1,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    });
    let created: boolean;
    try {
      created = await this.dependencies.storage.createLectureStudio(studio);
    } catch (error) {
      if (claimedExternalSources) {
        await this.dependencies.externalSources
          .rollbackClaim({ projectId: command.outputProjectId, studioId })
          .catch(() => undefined);
      }
      throw this.normalizeStorageError(error);
    }
    if (!created) {
      if (claimedExternalSources) {
        await this.dependencies.externalSources
          .rollbackClaim({ projectId: command.outputProjectId, studioId })
          .catch(() => undefined);
      }
      throw new LectureStudioServiceError('lecture_persistence_failed');
    }
    if (externalSelection) {
      await this.dependencies.externalSources
        .discard({
          projectId: command.outputProjectId,
          sourceSetId: externalSelection.sourceSetId,
        })
        .catch(() => undefined);
    }
    this.publish(studio);
    return studio;
  }

  async generate(input: GenerateLectureStudioInput): Promise<LectureStudioTurnReceipt> {
    const command = GenerateLectureStudioInputSchema.parse(input);
    return this.runTurn({ ...command, message: null, attachmentIds: [] });
  }

  async updateGenerationBrief(
    input: UpdateLectureStudioGenerationBriefInput,
  ): Promise<LectureStudio> {
    const command = UpdateLectureStudioGenerationBriefInputSchema.parse(input);
    if (
      this.activeByStudio.has(command.studioId) ||
      this.manualSaveByStudio.has(command.studioId)
    ) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    const studio = await this.dependencies.storage.getLectureStudio(command.studioId);
    if (!studio) throw new LectureStudioServiceError('lecture_studio_not_found');
    if (studio.trashedAt) throw new LectureStudioServiceError('lecture_studio_trashed');
    if (studio.status === 'generating' || studio.activeAttemptId) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    if (studio.version !== command.expectedVersion) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    assertNoNewLectureSourceListAliasTitles(command.generationBrief, studio.generationBrief);
    this.throwIfProjectsLifecycleLocked([...studio.sourceProjectIds, studio.outputProjectId]);
    if (JSON.stringify(studio.generationBrief) === JSON.stringify(command.generationBrief)) {
      return LectureStudioSchema.parse(studio);
    }
    let updated: LectureStudio | null;
    try {
      updated = await this.dependencies.storage.updateLectureStudioGenerationBrief(
        studio.id,
        studio.version,
        command.generationBrief,
        this.now().toISOString(),
      );
    } catch (error) {
      throw this.normalizeStorageError(error);
    }
    if (!updated) throw new LectureStudioServiceError('lecture_version_conflict');
    this.publish(updated);
    return LectureStudioSchema.parse(updated);
  }

  async editDraft(input: GetLectureStudioEditDraftInput): Promise<LectureStudioEditDraft> {
    const command = GetLectureStudioEditDraftInputSchema.parse(input);
    if (this.manualSaveByStudio.has(command.studioId)) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    const studio = await this.requireStudio(command.studioId);
    if (studio.version !== command.expectedVersion) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    if (studio.status === 'generating' || studio.activeAttemptId) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    if (studio.currentRevision !== command.baseRevision) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    const revision = await this.dependencies.storage.getLectureStudioRevision(
      studio.id,
      command.baseRevision,
    );
    if (!revision || revision.id !== command.baseRevisionId) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    if (revision.schemaVersion === 1) {
      throw new LectureStudioServiceError('lecture_unavailable');
    }
    const notes = extractEditableLectureLatexBody(
      'lecture-notes',
      studio.title,
      revision.lectureNotesLatex,
    );
    const slides = extractEditableLectureLatexBody('slides', studio.title, revision.slidesLatex);
    if (JSON.stringify(notes.features) !== JSON.stringify(slides.features)) {
      throw new LectureStudioServiceError('lecture_artifact_changed');
    }
    const figures = await this.dependencies.storage.listLectureStudioFigures(studio.id);
    return LectureStudioEditDraftSchema.parse({
      schemaVersion: 1,
      studioId: studio.id,
      studioVersion: studio.version,
      baseRevisionId: revision.id,
      baseRevision: revision.revision,
      lectureNotesLatexBody: notes.body,
      slidesLatexBody: slides.body,
      figures,
    });
  }

  async saveManualRevision(
    input: SaveLectureStudioManualRevisionInput,
  ): Promise<LectureStudioManualRevisionReceipt> {
    const command = SaveLectureStudioManualRevisionInputSchema.parse(input);
    if (
      this.activeByStudio.has(command.studioId) ||
      this.manualSaveByStudio.has(command.studioId)
    ) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    this.manualSaveByStudio.add(command.studioId);
    let pendingArtifactInput:
      Parameters<LectureStudioArtifactWriter['saveRevisionArtifacts']>[0] | null = null;
    try {
      const studio = await this.requireStudio(command.studioId);
      this.throwIfProjectsLifecycleLocked([...studio.sourceProjectIds, studio.outputProjectId]);
      if (
        studio.version !== command.expectedVersion ||
        studio.currentRevision !== command.baseRevision
      ) {
        throw new LectureStudioServiceError('lecture_version_conflict');
      }
      if (studio.status === 'generating' || studio.activeAttemptId) {
        throw new LectureStudioServiceError('lecture_busy');
      }
      if (studio.currentRevision < 1 || (studio.status !== 'ready' && studio.status !== 'failed')) {
        throw new LectureStudioServiceError('lecture_unavailable');
      }
      try {
        await this.dependencies.artifacts.assertRevisionDestination(studio.outputProjectId);
      } catch (error) {
        throw this.normalizeArtifactError(error);
      }
      const baseRevision = await this.dependencies.storage.getLectureStudioRevision(
        studio.id,
        command.baseRevision,
      );
      if (!baseRevision || baseRevision.id !== command.baseRevisionId) {
        throw new LectureStudioServiceError('lecture_version_conflict');
      }
      if (baseRevision.schemaVersion === 1) {
        throw new LectureStudioServiceError('lecture_unavailable');
      }
      const baseNotes = extractEditableLectureLatexBody(
        'lecture-notes',
        studio.title,
        baseRevision.lectureNotesLatex,
      );
      const baseSlides = extractEditableLectureLatexBody(
        'slides',
        studio.title,
        baseRevision.slidesLatex,
      );
      if (JSON.stringify(baseNotes.features) !== JSON.stringify(baseSlides.features)) {
        throw new LectureStudioServiceError('lecture_artifact_changed');
      }
      const figures = this.dependencies.figures;
      const availableFigures = figures
        ? await figures.list({ studioId: studio.id })
        : await this.dependencies.storage.listLectureStudioFigures(studio.id);
      const validationGenerationBrief = CurrentLectureStudioGenerationBriefValueSchema.parse({
        ...(baseRevision.schemaVersion === 3 || baseRevision.schemaVersion === 4
          ? baseRevision.generationBriefSnapshot
          : studio.generationBrief),
        documentFeatures: baseNotes.features,
      });
      // Manual edits preserve the exact historical authoring provenance. In particular, a
      // pre-policy-v7 v3 snapshot intentionally has no documentFeatures field; materializing
      // that field here would change the hashed JSON and make an otherwise valid direct edit
      // fail the append-only DB compare-and-swap. The enriched brief is only for validating
      // the edited bodies against the effective canonical wrapper features.
      const revisionGenerationBrief =
        baseRevision.schemaVersion === 3 || baseRevision.schemaVersion === 4
          ? baseRevision.generationBriefSnapshot
          : validationGenerationBrief;
      const frozenStudio = { ...studio, generationBrief: validationGenerationBrief };
      const requestedEditedKinds = [
        ...(command.lectureNotesLatexBody !== baseNotes.body ? (['lecture-notes'] as const) : []),
        ...(command.slidesLatexBody !== baseSlides.body ? (['slides'] as const) : []),
      ];
      if (requestedEditedKinds.length === 0) {
        throw new LectureStudioServiceError('invalid_lecture_input');
      }
      const output = this.parseOutput(
        null,
        frozenStudio,
        baseRevision.sourceManifest,
        baseRevision,
        [],
        baseNotes.features,
        {
          prevalidatedOutput: {
            reply: 'Saved a direct source edit.',
            lectureNotesLatexBody: command.lectureNotesLatexBody,
            slidesLatexBody: command.slidesLatexBody,
          },
          trustedCanonicalBodies: {
            ...(requestedEditedKinds.includes('lecture-notes')
              ? {}
              : { 'lecture-notes': baseNotes.body }),
            ...(requestedEditedKinds.includes('slides') ? {} : { slides: baseSlides.body }),
          },
          availableFigureIds: availableFigures.map((figure) => figure.id),
          enforceSlideCount: false,
        },
      );
      const editedKinds = [
        ...(output.lectureNotesLatexBody !== baseNotes.body ? (['lecture-notes'] as const) : []),
        ...(output.slidesLatexBody !== baseSlides.body ? (['slides'] as const) : []),
      ];
      if (editedKinds.length === 0) {
        throw new LectureStudioServiceError('invalid_lecture_input');
      }
      if (output.figureIds.length > 0 && !figures) {
        throw new LectureStudioServiceError('lecture_figure_unavailable');
      }
      let figureSnapshots: readonly LectureStudioFigureSnapshot[] = [];
      if (output.figureIds.length > 0) {
        try {
          figureSnapshots = await figures!.snapshotFigures(studio.id, output.figureIds);
        } catch (error) {
          throw lectureErrorFromFigureService(error);
        }
      }
      const revisionNumber = baseRevision.revision + 1;
      const operationId = randomUUID();
      const manualAuthoringPolicy =
        baseRevision.schemaVersion === 3 || baseRevision.schemaVersion === 4
          ? {
              version: baseRevision.authoringPolicyVersion,
              sha256: baseRevision.authoringPolicySha256,
            }
          : {
              version: LECTURE_STUDIO_AUTHORING_POLICY_VERSION,
              sha256: sha256(LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS),
            };
      // A paired manual revision keeps the untouched counterpart byte-for-byte identical.
      // This is also required for legacy v1/v2 canonical wrappers: rebuilding an unchanged
      // document with the current wrapper would turn a one-document edit into an implicit
      // two-document migration and disagree with the append-only authorship record.
      const lectureNotesLatex = editedKinds.includes('lecture-notes')
        ? buildLectureLatexDocument(
            'lecture-notes',
            studio.title,
            output.lectureNotesLatexBody,
            baseNotes.features,
            [...customLectureSourceListAliasTitles(revisionGenerationBrief)],
          )
        : baseRevision.lectureNotesLatex;
      const slidesLatex = editedKinds.includes('slides')
        ? buildLectureLatexDocument(
            'slides',
            studio.title,
            output.slidesLatexBody,
            baseNotes.features,
          )
        : baseRevision.slidesLatex;
      try {
        const compileResults = await Promise.allSettled(
          (
            [
              ['lecture-notes', lectureNotesLatex],
              ['slides', slidesLatex],
            ] as const
          ).map(([kind, source]) =>
            this.dependencies.pdfCompiler.compile({
              studioId: studio.id,
              revision: revisionNumber,
              title: studio.title,
              kind,
              markdown: source,
              contentSha256: sha256(source),
              sourceFormat: 'latex',
              figureAssets: figureSnapshots,
            }),
          ),
        );
        const failed = compileResults.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (failed) throw failed.reason;
      } catch (error) {
        if (error instanceof LectureDocumentCompilerError) {
          throw new LectureStudioServiceError(error.code);
        }
        if (error instanceof LectureStudioServiceError) throw error;
        throw new LectureStudioServiceError('lecture_pdf_compile_failed');
      }
      const createdAt = this.now().toISOString();
      const generationBriefSha256 =
        baseRevision.schemaVersion === 3 || baseRevision.schemaVersion === 4
          ? baseRevision.generationBriefSha256
          : sha256(JSON.stringify(revisionGenerationBrief));
      const artifactInput = {
        outputProjectId: studio.outputProjectId,
        studioId: studio.id,
        studioTitle: studio.title,
        revision: revisionNumber,
        attemptId: operationId,
        sourceManifestSha256: baseRevision.sourceManifestSha256,
        generationBriefSha256,
        authoringPolicyVersion: manualAuthoringPolicy.version,
        authoringPolicySha256: manualAuthoringPolicy.sha256,
        documentFormat: 'latex' as const,
        lectureNotesLatex,
        slidesLatex,
        createdAt,
        figureAssets: figureSnapshots,
        relatedDocuments: [],
        relatedPapers: uniqueNonEmpty(
          baseRevision.sourceManifest.literature
            .map((source) => canonicalDoiUrl(source.doi))
            .filter((value): value is string => value !== null),
          128,
        ),
      } as const;
      pendingArtifactInput = artifactInput;
      const artifacts = await this.saveArtifacts(artifactInput);
      const revision = LectureStudioRevisionV4Schema.parse({
        schemaVersion: 4,
        id: randomUUID(),
        studioId: studio.id,
        revision: revisionNumber,
        attemptId: operationId,
        sourceManifest: baseRevision.sourceManifest,
        sourceManifestSha256: baseRevision.sourceManifestSha256,
        lectureNotesLatex,
        slidesLatex,
        generationBriefSnapshot: revisionGenerationBrief,
        generationBriefSha256,
        authoringPolicyVersion: manualAuthoringPolicy.version,
        authoringPolicySha256: manualAuthoringPolicy.sha256,
        artifacts,
        invocation: null,
        authorship: {
          kind: 'manual',
          baseRevisionId: baseRevision.id,
          baseRevision: baseRevision.revision,
          editedKinds,
        },
        figureAssets: figureSnapshots.map((snapshot) => snapshot.asset),
        createdAt,
      });
      let stored: LectureStudio | null;
      try {
        stored = await this.dependencies.storage.commitManualLectureStudioRevision({
          studioId: studio.id,
          expectedVersion: studio.version,
          expectedCurrentRevision: baseRevision.revision,
          revision,
          updatedAt: createdAt,
        });
      } catch (error) {
        throw this.normalizeStorageError(error);
      }
      if (!stored) throw new LectureStudioServiceError('lecture_version_conflict');
      pendingArtifactInput = null;
      await Promise.resolve(
        this.dependencies.artifacts.confirmRevisionArtifacts(artifactInput),
      ).catch(() => undefined);
      this.publish(stored);
      return LectureStudioManualRevisionReceiptSchema.parse({ studio: stored, revision });
    } catch (error) {
      if (pendingArtifactInput) {
        await Promise.resolve(
          this.dependencies.artifacts.rollbackRevisionArtifacts(pendingArtifactInput),
        ).catch(() => undefined);
      }
      if (error instanceof LectureStudioServiceError) throw error;
      if (error instanceof LectureOutputValidationError) {
        throw new LectureStudioServiceError(error.code);
      }
      if (error instanceof LectureLatexSourceError) {
        throw new LectureStudioServiceError('lecture_invalid_latex_grammar');
      }
      if (error instanceof LectureStudioFigureServiceError) {
        throw lectureErrorFromFigureService(error);
      }
      throw error;
    } finally {
      this.manualSaveByStudio.delete(command.studioId);
    }
  }

  async trash(input: LectureStudioVersionCommand): Promise<LectureStudio> {
    const command = LectureStudioVersionCommandSchema.parse(input);
    if (
      this.activeByStudio.has(command.studioId) ||
      this.manualSaveByStudio.has(command.studioId)
    ) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    const studio = await this.dependencies.storage.getLectureStudio(command.studioId);
    if (!studio) throw new LectureStudioServiceError('lecture_studio_not_found');
    if (studio.trashedAt) throw new LectureStudioServiceError('lecture_studio_trashed');
    if (studio.status === 'generating' || studio.activeAttemptId) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    if (studio.version !== command.expectedVersion) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    const now = this.now().toISOString();
    let trashed: LectureStudio | null;
    try {
      trashed = await this.dependencies.storage.setLectureStudioTrashed(
        studio.id,
        studio.version,
        now,
        now,
      );
    } catch (error) {
      throw this.normalizeStorageError(error);
    }
    if (!trashed) throw new LectureStudioServiceError('lecture_version_conflict');
    this.publish(trashed);
    return LectureStudioSchema.parse(trashed);
  }

  async restore(input: LectureStudioVersionCommand): Promise<LectureStudio> {
    const command = LectureStudioVersionCommandSchema.parse(input);
    const studio = await this.dependencies.storage.getLectureStudio(command.studioId);
    if (!studio) throw new LectureStudioServiceError('lecture_studio_not_found');
    if (!studio.trashedAt) throw new LectureStudioServiceError('lecture_studio_not_trashed');
    if (studio.version !== command.expectedVersion) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    let restored: LectureStudio | null;
    try {
      restored = await this.dependencies.storage.setLectureStudioTrashed(
        studio.id,
        studio.version,
        null,
        this.now().toISOString(),
      );
    } catch (error) {
      throw this.normalizeStorageError(error);
    }
    if (!restored) throw new LectureStudioServiceError('lecture_version_conflict');
    this.publish(restored);
    return LectureStudioSchema.parse(restored);
  }

  async emptyTrash(input: EmptyLectureStudioTrashInput): Promise<EmptyLectureStudioTrashReceipt> {
    const command = EmptyLectureStudioTrashInputSchema.parse(input);
    const trashed = await this.dependencies.storage.listLectureStudios(true);
    const trashedStudios = trashed.filter((studio) => studio.trashedAt !== undefined);
    if (trashedStudios.some((studio) => this.activeByStudio.has(studio.id))) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    let receipt: EmptyLectureStudioTrashReceipt | null;
    try {
      receipt = await this.dependencies.storage.emptyLectureStudioTrash(
        command,
        this.now().toISOString(),
      );
    } catch (error) {
      throw this.normalizeStorageError(error);
    }
    if (!receipt) {
      if (trashedStudios.length === 0) {
        throw new LectureStudioServiceError('lecture_trash_empty');
      }
      throw new LectureStudioServiceError('lecture_persistence_failed');
    }
    const parsed = EmptyLectureStudioTrashReceiptSchema.parse(receipt);
    await Promise.allSettled(
      parsed.removedStudios.map(({ outputProjectId, studioId }) =>
        this.dependencies.externalSources.purgeStudio({ projectId: outputProjectId, studioId }),
      ),
    );
    return parsed;
  }

  async send(input: SendLectureStudioMessageInput): Promise<LectureStudioTurnReceipt> {
    const command = SendLectureStudioMessageInputSchema.parse(input);
    return this.runTurn({ ...command, attachmentIds: command.attachmentIds ?? [] });
  }

  async compilePdf(input: CompileLectureStudioPdfInput): Promise<LectureStudioPdfPreview> {
    const command = CompileLectureStudioPdfInputSchema.parse(input);
    const compiler = this.dependencies.pdfCompiler;
    if (!compiler) {
      throw new LectureStudioServiceError('lecture_pdf_compiler_unavailable');
    }
    const studio = await this.requireStudio(command.studioId);
    const revision = await this.dependencies.storage.getLectureStudioRevision(
      studio.id,
      command.revision,
    );
    if (!revision || revision.revision > studio.currentRevision) {
      throw new LectureStudioServiceError('lecture_source_not_found');
    }
    const source = lectureRevisionSource(revision, command.kind);
    if (sha256(source) !== command.contentSha256) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    try {
      const figureAssets = await this.figureSnapshotsForRevision(revision);
      return await compiler.compile({
        studioId: studio.id,
        revision: revision.revision,
        title: studio.title,
        kind: command.kind,
        markdown: source,
        contentSha256: command.contentSha256,
        sourceFormat: lectureRevisionFormat(revision),
        figureAssets,
      });
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      if (error instanceof LectureDocumentCompilerError) {
        throw new LectureStudioServiceError(error.code);
      }
      throw new LectureStudioServiceError('lecture_pdf_compile_failed');
    }
  }

  async exportArtifact(
    input: ExportLectureStudioArtifactInput,
  ): Promise<LectureStudioArtifactActionReceipt> {
    const command = ExportLectureStudioArtifactInputSchema.parse(input);
    const platform = this.requireArtifactPlatform();
    const resolved = await this.resolveArtifactAction(command);
    this.assertArtifactFormat(resolved.revision, command.format);
    let bytes: Buffer;
    let suggestedFileName: string;
    if (command.format !== 'pdf') {
      const referencedFigureIds =
        command.format === 'latex' ? findLectureFigureAssetIds(resolved.file.content) : [];
      if (referencedFigureIds.length > 0) {
        const snapshots = await this.figureSnapshotsForRevision(resolved.revision);
        const byId = new Map(snapshots.map((snapshot) => [snapshot.asset.id, snapshot]));
        if (referencedFigureIds.some((figureId) => !byId.has(figureId))) {
          throw new LectureStudioServiceError('lecture_figure_unavailable');
        }
        const bundleEntries: Record<string, Uint8Array> = {
          [resolved.file.fileName]: Buffer.from(resolved.file.content, 'utf8'),
        };
        for (const figureId of referencedFigureIds) {
          const snapshot = byId.get(figureId)!;
          bundleEntries[snapshot.asset.fileName] = snapshot.bytes;
        }
        bytes = Buffer.from(zipSync(bundleEntries, { level: 6 }));
        suggestedFileName = `${resolved.file.fileName.replace(/\.tex$/iu, '')} bundle.zip`;
      } else {
        bytes = Buffer.from(resolved.file.content, 'utf8');
        suggestedFileName = resolved.file.fileName;
      }
    } else {
      const pdf = await this.compileResolvedArtifactPdf(resolved);
      bytes = lecturePdfExportBytes(pdf);
      suggestedFileName = command.kind === 'lecture-notes' ? 'Lecture Notes.pdf' : 'Slides.pdf';
    }
    try {
      const receipt = await platform.exportFile({
        format: command.format,
        suggestedFileName,
        bytes,
      });
      return LectureStudioArtifactActionReceiptSchema.parse({
        schemaVersion: 1,
        status: receipt.status,
        format: command.format,
        fileName: receipt.fileName,
        relativePath: resolved.file.relativePath,
      });
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      throw new LectureStudioServiceError('lecture_export_failed');
    }
  }

  async openArtifact(
    input: OpenLectureStudioArtifactInput,
  ): Promise<LectureStudioArtifactActionReceipt> {
    const command = OpenLectureStudioArtifactInputSchema.parse(input);
    const platform = this.requireArtifactPlatform();
    const resolved = await this.resolveArtifactAction(command);
    this.assertArtifactFormat(resolved.revision, command.format);
    try {
      let fileName = resolved.file.fileName;
      if (command.format !== 'pdf') {
        await platform.openExisting(resolved.file.absolutePath);
      } else {
        const pdf = await this.compileResolvedArtifactPdf(resolved);
        fileName = await platform.openPdf({ kind: command.kind, document: pdf });
      }
      return LectureStudioArtifactActionReceiptSchema.parse({
        schemaVersion: 1,
        status: 'opened',
        format: command.format,
        fileName,
        relativePath: resolved.file.relativePath,
      });
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      throw new LectureStudioServiceError('lecture_open_failed');
    }
  }

  async revealArtifact(
    input: RevealLectureStudioArtifactInput,
  ): Promise<LectureStudioArtifactActionReceipt> {
    const command = RevealLectureStudioArtifactInputSchema.parse(input);
    const platform = this.requireArtifactPlatform();
    const resolved = await this.resolveArtifactAction(command);
    this.assertArtifactFormat(resolved.revision, command.format);
    try {
      let fileName = resolved.file.fileName;
      let relativePath: string | null = resolved.file.relativePath;
      if (command.format !== 'pdf') {
        await platform.revealExisting(resolved.file.absolutePath);
      } else {
        const pdf = await this.compileResolvedArtifactPdf(resolved);
        fileName = await platform.revealPdf({ kind: command.kind, document: pdf });
        relativePath = null;
      }
      return LectureStudioArtifactActionReceiptSchema.parse({
        schemaVersion: 1,
        status: 'revealed',
        format: command.format,
        fileName,
        relativePath,
      });
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      throw new LectureStudioServiceError('lecture_open_failed');
    }
  }

  private requireArtifactPlatform() {
    const platform = this.dependencies.artifactPlatform;
    if (!platform) throw new LectureStudioServiceError('lecture_artifact_unavailable');
    return platform;
  }

  private assertArtifactFormat(
    revision: LectureStudioRevision,
    format: 'markdown' | 'latex' | 'pdf',
  ) {
    if (format === 'pdf') return;
    const expected = lectureRevisionFormat(revision);
    if (format !== expected) {
      throw new LectureStudioServiceError('lecture_artifact_changed');
    }
  }

  private async resolveArtifactAction(command: {
    studioId: string;
    revisionId: string;
    revision: number;
    kind: LectureStudioArtifact['kind'];
    artifactContentSha256: string;
  }) {
    const studio = await this.requireStudio(command.studioId);
    const revision = await this.dependencies.storage.getLectureStudioRevision(
      studio.id,
      command.revision,
    );
    if (
      !revision ||
      revision.id !== command.revisionId ||
      revision.revision > studio.currentRevision
    ) {
      throw new LectureStudioServiceError('lecture_artifact_not_found');
    }
    const artifact = revision.artifacts.find((candidate) => candidate.kind === command.kind);
    if (!artifact) throw new LectureStudioServiceError('lecture_artifact_not_found');
    if (artifact.contentSha256 !== command.artifactContentSha256) {
      throw new LectureStudioServiceError('lecture_artifact_changed');
    }
    try {
      const file = await this.dependencies.artifacts.resolveLectureRevisionArtifact(
        studio.outputProjectId,
        artifact,
      );
      if (file.contentSha256 !== artifact.contentSha256) {
        throw new LectureStudioServiceError('lecture_artifact_changed');
      }
      return { studio, revision, artifact, file };
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      if (
        isRecord(error) &&
        (error.code === 'research_notes_folder_conflict' ||
          error.message === 'research_notes_folder_conflict')
      ) {
        throw new LectureStudioServiceError('lecture_artifact_changed');
      }
      if (
        isRecord(error) &&
        (error.code === 'research_notes_note_not_found' ||
          error.message === 'research_notes_note_not_found')
      ) {
        throw new LectureStudioServiceError('lecture_artifact_not_found');
      }
      throw new LectureStudioServiceError('lecture_artifact_unavailable');
    }
  }

  private async compileResolvedArtifactPdf(
    resolved: Awaited<ReturnType<LectureStudioService['resolveArtifactAction']>>,
  ) {
    const compiler = this.dependencies.pdfCompiler;
    if (!compiler) throw new LectureStudioServiceError('lecture_pdf_compiler_unavailable');
    const source = lectureRevisionSource(resolved.revision, resolved.artifact.kind);
    const contentSha256 = sha256(source);
    try {
      const figureAssets = await this.figureSnapshotsForRevision(resolved.revision);
      const compiled = await compiler.compile({
        studioId: resolved.studio.id,
        revision: resolved.revision.revision,
        title: resolved.studio.title,
        kind: resolved.artifact.kind,
        markdown: source,
        contentSha256,
        sourceFormat: lectureRevisionFormat(resolved.revision),
        figureAssets,
      });
      try {
        lecturePdfExportBytes(compiled);
      } catch {
        throw new LectureStudioServiceError('lecture_pdf_invalid');
      }
      return compiled;
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      if (error instanceof LectureDocumentCompilerError) {
        throw new LectureStudioServiceError(error.code);
      }
      throw new LectureStudioServiceError('lecture_pdf_compile_failed');
    }
  }

  private async figureSnapshotsForRevision(revision: LectureStudioRevision) {
    if (revision.schemaVersion !== 4 || revision.figureAssets.length === 0) return [];
    const figures = this.dependencies.figures;
    if (!figures) throw new LectureStudioServiceError('lecture_figure_unavailable');
    try {
      return await figures.snapshotRevisionFigures(revision.studioId, revision.figureAssets);
    } catch (error) {
      throw lectureErrorFromFigureService(error);
    }
  }

  async cancel(input: CancelLectureStudioInput): Promise<LectureStudio> {
    const command = CancelLectureStudioInputSchema.parse(input);
    const studio = await this.requireStudio(command.studioId);
    if (studio.version !== command.expectedVersion) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    if (studio.status !== 'generating' || studio.activeAttemptId !== command.attemptId) {
      throw new LectureStudioServiceError('lecture_not_active');
    }
    const active = this.activeByStudio.get(studio.id);
    if (active && active.attemptId === command.attemptId) {
      const shouldInterruptTurn = !active.turnTerminal && active.threadId && active.turnId;
      active.cancelRequested = true;
      active.terminal = true;
      if (shouldInterruptTurn) {
        await this.dependencies.codex
          .interruptTurn(active.threadId!, active.turnId!)
          .catch(() => undefined);
      }
    }
    const cancelled = await this.dependencies.storage.failLectureStudioTurn({
      studioId: studio.id,
      attemptId: command.attemptId,
      errorCode: 'lecture_cancelled',
      messageStatus: 'interrupted',
      updatedAt: this.now().toISOString(),
    });
    if (!cancelled) throw new LectureStudioServiceError('lecture_version_conflict');
    this.publish(cancelled);
    return cancelled;
  }

  async runWhenProjectsIdle<T>(
    projectIds: readonly string[],
    operation: () => Promise<T>,
    requireNoStudios = false,
  ) {
    const lockedProjectIds = [...new Set(projectIds)].sort();
    if (lockedProjectIds.some((projectId) => this.lifecycleLockedProjects.has(projectId))) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    for (const projectId of lockedProjectIds) this.lifecycleLockedProjects.add(projectId);
    try {
      const targetIds = new Set(lockedProjectIds);
      const summaries = await this.dependencies.storage.listLectureStudios(true);
      const studios = await Promise.all(
        summaries.map((summary) => this.dependencies.storage.getLectureStudio(summary.id)),
      );
      const hasActiveWork = studios.some(
        (studio) =>
          studio !== null &&
          this.studioTouchesProjects(studio, targetIds) &&
          (studio.status === 'generating' ||
            this.activeByStudio.has(studio.id) ||
            this.manualSaveByStudio.has(studio.id)),
      );
      if (hasActiveWork) throw new LectureStudioServiceError('lecture_busy');
      if (
        requireNoStudios &&
        studios.some((studio) => studio !== null && this.studioTouchesProjects(studio, targetIds))
      ) {
        throw new LectureStudioServiceError('lecture_busy');
      }
      return await operation();
    } finally {
      for (const projectId of lockedProjectIds) this.lifecycleLockedProjects.delete(projectId);
    }
  }

  private async runTurn(request: TurnRequest): Promise<LectureStudioTurnReceipt> {
    if (
      this.activeByStudio.has(request.studioId) ||
      this.manualSaveByStudio.has(request.studioId)
    ) {
      throw new LectureStudioServiceError('lecture_busy');
    }
    const current = await this.requireStudio(request.studioId);
    this.throwIfProjectsLifecycleLocked([...current.sourceProjectIds, current.outputProjectId]);
    if (current.version !== request.expectedVersion) {
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    if (current.status === 'generating') throw new LectureStudioServiceError('lecture_busy');
    try {
      await this.dependencies.artifacts.assertRevisionDestination(current.outputProjectId);
    } catch (error) {
      throw this.normalizeArtifactError(error);
    }
    const previousRevision = await this.dependencies.storage.getCurrentLectureStudioRevision(
      current.id,
    );
    const documentFeatures = resolveLectureDocumentFeaturesForTurn(
      current,
      previousRevision,
      request.message,
    );
    const explicitlyEnabledTitlePage =
      request.message !== null && classifyLectureTitleSlideDirective(request.message) === true;
    const turnGenerationBrief = CurrentLectureStudioGenerationBriefValueSchema.parse({
      ...current.generationBrief,
      slidesTargetPages:
        explicitlyEnabledTitlePage && current.generationBrief.slidesTargetPages === 1
          ? 2
          : current.generationBrief.slidesTargetPages,
      documentFeatures,
    });

    let preparedAttachments: PreparedLectureStudioAttachments | null = null;
    if (request.attachmentIds.length > 0) {
      if (!this.dependencies.attachments) {
        throw new LectureExternalSourceError('lecture_external_source_expired');
      }
      preparedAttachments = await this.dependencies.attachments.prepare(
        current,
        request.attachmentIds,
      );
    }

    let availableFigureSnapshots: readonly LectureStudioFigureSnapshot[] = [];
    let materializedFigures: MaterializedLectureStudioFigures | null = null;
    if (this.dependencies.figures) {
      try {
        availableFigureSnapshots = await this.dependencies.figures.snapshotFigures(current.id);
        if (availableFigureSnapshots.length > 0) {
          materializedFigures = await this.dependencies.figures.materializeActiveFigures(
            current.id,
            availableFigureSnapshots.map((snapshot) => snapshot.asset.id),
          );
        }
      } catch (error) {
        await preparedAttachments?.rollback().catch(() => undefined);
        throw lectureErrorFromFigureService(error);
      }
    }

    const attemptId = randomUUID();
    const startedAt = this.now().toISOString();
    const attempt = LectureStudioAttemptSchema.parse({
      schemaVersion: 1,
      id: attemptId,
      studioId: current.id,
      status: 'running',
      requestedModelId: request.requestedModelId,
      resolvedModelId: null,
      providerId: null,
      catalogVersion: null,
      reasoningOptionId: request.reasoningOptionId,
      phases: [],
      validations: [],
      terminalCode: null,
      startedAt,
      completedAt: null,
    });
    const userMessage = request.message
      ? LectureStudioMessageSchema.parse({
          schemaVersion: 1,
          id: randomUUID(),
          studioId: current.id,
          role: 'user',
          status: 'complete',
          content: request.message,
          attemptId,
          revision: null,
          invocation: null,
          ...(preparedAttachments ? { attachments: preparedAttachments.cards } : {}),
          createdAt: startedAt,
          completedAt: startedAt,
        })
      : null;
    let generating: LectureStudio | null;
    try {
      this.throwIfProjectsLifecycleLocked([...current.sourceProjectIds, current.outputProjectId]);
      generating = await this.dependencies.storage.beginLectureStudioTurn({
        studioId: current.id,
        expectedVersion: current.version,
        attemptId,
        userMessage,
        updatedAt: startedAt,
        generationBrief: turnGenerationBrief,
        attempt,
      });
    } catch (error) {
      await preparedAttachments?.rollback().catch(() => undefined);
      await materializedFigures?.cleanup().catch(() => undefined);
      throw this.normalizeStorageError(error);
    }
    if (!generating) {
      await materializedFigures?.cleanup().catch(() => undefined);
      throw new LectureStudioServiceError('lecture_version_conflict');
    }
    const active: ActiveExecution = {
      studioId: generating.id,
      attemptId,
      startedAt,
      progressSequence: 0,
      lastActivityProgressAt: Number.NEGATIVE_INFINITY,
      threadId: null,
      turnId: null,
      cancelRequested: false,
      terminal: false,
      turnTerminal: false,
    };
    this.activeByStudio.set(generating.id, active);
    this.publish(generating);
    this.publishProgress(active, 'preparing_sources');
    if (previousRevision) this.publishProgress(active, 'loading_current_revision');

    let threadId: string | null = null;
    let turnId: string | null = null;
    let pendingArtifactInput:
      Parameters<LectureStudioArtifactWriter['saveRevisionArtifacts']>[0] | null = null;
    try {
      const [baseSourceManifest, messages, cwd] = await Promise.all([
        this.resolveSourceManifest(
          generating.sourceProjectIds,
          generating.sourceSelection,
          generating.id,
          generating.outputProjectId,
        ),
        this.dependencies.storage.listLectureStudioMessages(generating.id, 12),
        this.dependencies.prepareDirectory(generating.outputProjectId),
      ]);
      const sourceManifest = sourceManifestWithTurnAttachments(
        baseSourceManifest,
        preparedAttachments?.snapshots ?? [],
      );
      const retiredAttachmentLabels = retiredTurnAttachmentLabels(previousRevision, sourceManifest);
      this.throwIfCancelled(active);
      const sourceManifestSha256 = sha256(JSON.stringify(sourceManifest));
      this.publishProgress(active, 'preparing_edit_context');
      this.publishProgress(active, 'starting_model');
      let started: Awaited<ReturnType<LectureStudioCodex['startThread']>>;
      try {
        started = await this.dependencies.codex.startThread({
          cwd,
          modelId: request.requestedModelId,
          developerInstructions: LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS,
          responseVerbosity: 'medium',
          dynamicTools: [],
          webSearchMode: 'disabled',
        });
      } catch (error) {
        throw new LectureStudioServiceError(lectureErrorFromCodexRequest(error));
      }
      const activeThreadId = started.threadId;
      threadId = activeThreadId;
      active.threadId = activeThreadId;
      this.dependencies.usage?.bindThread(activeThreadId, {
        workloadKind: 'lecture_generation',
        projectId: generating.outputProjectId,
        lectureStudioId: generating.id,
        lectureAttemptId: attemptId,
      });
      this.throwIfCancelled(active);

      const idleTimeoutMs = Math.max(
        5_000,
        Math.min(this.dependencies.timeoutMs ?? 180_000, 1_800_000),
      );
      const hardTimeoutMs = Math.max(
        idleTimeoutMs,
        Math.min(this.dependencies.hardTimeoutMs ?? 1_800_000, 1_800_000),
      );
      const hardDeadline = Date.now() + hardTimeoutMs;
      const executeCodexTurn = async (
        prompt: string,
        outputSchema: Readonly<Record<string, unknown>>,
      ) => {
        if (Date.now() >= hardDeadline) {
          throw new LectureStudioServiceError('lecture_generation_timed_out');
        }
        active.turnTerminal = false;
        active.turnId = null;
        turnId = null;
        const completed = new Promise<LectureTurnResult>((resolve) => {
          this.pendingByThread.set(activeThreadId, {
            studioId: generating.id,
            attemptId,
            threadId: activeThreadId,
            turnId: null,
            invocation: null,
            earlyInvocation: null,
            finalText: null,
            terminal: false,
            nativeImageRejected: false,
            markActivity: null,
            disposeTimers: null,
            resolve,
          });
        });
        let running: Awaited<ReturnType<LectureStudioCodex['runTurn']>>;
        try {
          running = await this.dependencies.codex.runTurn({
            threadId: activeThreadId,
            prompt,
            ...(materializedFigures?.localImagePaths.length
              ? { localImagePaths: materializedFigures.localImagePaths }
              : {}),
            requestedModelId: request.requestedModelId,
            reasoningOptionId: request.reasoningOptionId,
            cwd,
            outputSchema,
          });
        } catch (error) {
          throw new LectureStudioServiceError(lectureErrorFromCodexRequest(error));
        }
        turnId = running.turnId;
        active.turnId = turnId;
        if (Date.now() >= hardDeadline) {
          throw new LectureStudioServiceError('lecture_generation_timed_out');
        }
        this.throwIfCancelled(active);
        const pending = this.pendingByThread.get(activeThreadId);
        if (!pending) throw new LectureStudioServiceError('lecture_generation_failed');
        pending.turnId = turnId;
        const attemptInvocation =
          pending.earlyInvocation?.turnId === turnId
            ? pending.earlyInvocation.invocation
            : running.invocation;
        pending.invocation = attemptInvocation;
        await this.recordAttemptBestEffort(() =>
          this.dependencies.storage.recordLectureStudioAttemptInvocation(
            generating.id,
            attemptId,
            attemptInvocation,
          ),
        );

        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        let hardTimer: ReturnType<typeof setTimeout> | null = null;
        let timeoutSettled = false;
        let resolveTimeout: ((result: LectureTurnResult) => void) | null = null;
        const timeout = new Promise<LectureTurnResult>((resolve) => {
          resolveTimeout = resolve;
        });
        const clearGenerationTimers = () => {
          if (idleTimer) clearTimeout(idleTimer);
          if (hardTimer) clearTimeout(hardTimer);
          idleTimer = null;
          hardTimer = null;
          pending.markActivity = null;
          pending.disposeTimers = null;
        };
        const expireGeneration = () => {
          if (timeoutSettled) return;
          timeoutSettled = true;
          clearGenerationTimers();
          resolveTimeout?.({ status: 'timed_out', text: null, failureCode: null });
        };
        const armIdleTimer = () => {
          if (timeoutSettled || pending.terminal) return;
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(expireGeneration, idleTimeoutMs);
          idleTimer.unref?.();
        };
        pending.markActivity = () => {
          armIdleTimer();
          this.publishProgress(active, 'model_active', true);
        };
        pending.disposeTimers = clearGenerationTimers;
        armIdleTimer();
        hardTimer = setTimeout(expireGeneration, Math.max(0, hardDeadline - Date.now()));
        hardTimer.unref?.();
        void completed.then(clearGenerationTimers, clearGenerationTimers);

        for (const notification of this.bufferedByThread.get(activeThreadId) ?? []) {
          this.processNotification(pending, notification);
        }
        this.bufferedByThread.delete(activeThreadId);
        this.throwIfCancelled(active);

        const terminal = await Promise.race([completed, timeout]);
        if (terminal.status !== 'timed_out') active.turnTerminal = true;
        if (terminal.status !== 'completed') {
          throw new LectureStudioServiceError(
            active.cancelRequested
              ? 'lecture_cancelled'
              : terminal.status === 'timed_out'
                ? 'lecture_generation_timed_out'
                : terminal.status === 'transport_failed'
                  ? (terminal.failureCode ?? 'lecture_codex_unavailable')
                  : (terminal.failureCode ?? 'lecture_generation_failed'),
          );
        }
        this.throwIfCancelled(active);
        return { terminal, pending, running };
      };
      const recordValidation = async (
        pass: LectureStudioAttemptValidation['pass'],
        error: LectureOutputValidationError,
      ) => {
        const validation: LectureStudioAttemptValidation = {
          pass,
          category: error.category,
          diagnostics: error.latexDiagnostics.map((diagnostic) => ({
            document: diagnostic.document,
            reason: diagnostic.reason,
            tokenCount: diagnostic.tokens.length,
          })),
          recordedAt: this.now().toISOString(),
        };
        await this.recordAttemptBestEffort(() =>
          this.dependencies.storage.recordLectureStudioAttemptValidation(
            generating.id,
            attemptId,
            validation,
          ),
        );
      };

      const previousDraft = previousRevision
        ? {
            sourceFormat:
              previousRevision.schemaVersion !== 1
                ? ('latex' as const)
                : ('legacy-markdown' as const),
            lectureNotes:
              previousRevision.schemaVersion !== 1
                ? rehydrateLectureEvidenceAnchors(
                    extractEditableLectureLatexBody(
                      'lecture-notes',
                      generating.title,
                      previousRevision.lectureNotesLatex,
                    ).body,
                  )
                : previousRevision.lectureNotesMarkdown,
            slides:
              previousRevision.schemaVersion !== 1
                ? rehydrateLectureEvidenceAnchors(
                    extractEditableLectureLatexBody(
                      'slides',
                      generating.title,
                      previousRevision.slidesLatex,
                    ).body,
                  )
                : previousRevision.slidesMarkdown,
          }
        : null;
      const currentDraft = previousDraft
        ? sanitizeLectureStudioCurrentDraftTurnAttachments(previousDraft, retiredAttachmentLabels)
        : null;
      const revisionPatchMode = request.message !== null && currentDraft?.sourceFormat === 'latex';
      const turnOutputSchema = revisionPatchMode
        ? LECTURE_STUDIO_REVISION_PATCH_OUTPUT_SCHEMA
        : LECTURE_STUDIO_OUTPUT_SCHEMA;
      const activeDocumentFeatures = resolveLectureStudioDocumentFeatures(
        generating.generationBrief.documentFeatures,
      );
      const frozenGenerationBrief = CurrentLectureStudioGenerationBriefValueSchema.parse({
        ...generating.generationBrief,
        documentFeatures: activeDocumentFeatures,
      });
      const initialPrompt = buildLectureStudioPrompt({
        mode: previousRevision ? 'revision' : 'initial',
        title: generating.title,
        kind: generating.kind,
        durationMinutes: generating.durationMinutes,
        generationBrief: frozenGenerationBrief,
        sourceManifest,
        figureAssets: (materializedFigures?.figures ?? []).map((figure) => ({
          id: figure.id,
          displayName: figure.displayName,
          fileName: figure.fileName,
          mediaType: figure.mediaType,
          byteSize: figure.byteSize,
          width: figure.width,
          height: figure.height,
          contentSha256: figure.sha256,
          origin: figure.origin,
        })),
        currentDraft,
        recentMessages: messages
          .filter((message) => message.id !== userMessage?.id && message.status === 'complete')
          .map((message) => ({
            role: message.role,
            content: message.content,
          })),
        request: request.message,
      });
      this.publishProgress(active, previousRevision ? 'revising_draft' : 'generating_draft');
      const parseTurnOutput = (text: string | null) =>
        revisionPatchMode
          ? this.parseRevisionPatchOutput(
              text,
              currentDraft,
              generating,
              sourceManifest,
              previousRevision,
              retiredAttachmentLabels,
              activeDocumentFeatures,
              availableFigureSnapshots.map((snapshot) => snapshot.asset.id),
            )
          : this.parseOutput(
              text,
              generating,
              sourceManifest,
              previousRevision,
              retiredAttachmentLabels,
              activeDocumentFeatures,
              {
                availableFigureIds: availableFigureSnapshots.map((snapshot) => snapshot.asset.id),
              },
            );
      let execution = await executeCodexTurn(initialPrompt, turnOutputSchema);
      let output;
      try {
        this.publishProgress(active, 'validating_output');
        output = parseTurnOutput(execution.terminal.text);
      } catch (error) {
        if (!(error instanceof LectureOutputValidationError)) throw error;
        await recordValidation('initial', error);
        this.throwIfCancelled(active);
        this.publishProgress(active, 'correcting_output');
        execution = await executeCodexTurn(
          correctionPrompt(
            error,
            generating,
            activeDocumentFeatures,
            revisionPatchMode ? 'patch' : 'complete',
          ),
          turnOutputSchema,
        );
        try {
          this.publishProgress(active, 'validating_output');
          output = parseTurnOutput(execution.terminal.text);
        } catch (correctionError) {
          if (correctionError instanceof LectureOutputValidationError) {
            await recordValidation('correction', correctionError);
            throw new LectureStudioServiceError(correctionError.code);
          }
          throw correctionError;
        }
      }
      const revisionNumber = generating.currentRevision + 1;
      const invocation = execution.pending.invocation ?? execution.running.invocation;
      const figureSnapshotById = new Map(
        availableFigureSnapshots.map((snapshot) => [snapshot.asset.id.toLowerCase(), snapshot]),
      );
      const usedFigureSnapshots = output.figureIds.map((figureId) => {
        const snapshot = figureSnapshotById.get(figureId.toLowerCase());
        if (!snapshot) throw new LectureStudioServiceError('lecture_figure_unavailable');
        return snapshot;
      });
      const lectureNotesLatex = buildLectureLatexDocument(
        'lecture-notes',
        generating.title,
        output.lectureNotesLatexBody,
        activeDocumentFeatures,
        [...customLectureSourceListAliasTitles(generating.generationBrief)],
      );
      const slidesLatex = buildLectureLatexDocument(
        'slides',
        generating.title,
        output.slidesLatexBody,
        activeDocumentFeatures,
      );
      this.publishProgress(active, 'compiling_documents');
      try {
        const compileResults = await Promise.allSettled(
          (
            [
              ['lecture-notes', lectureNotesLatex],
              ['slides', slidesLatex],
            ] as const
          ).map(([kind, source]) =>
            this.dependencies.pdfCompiler.compile({
              studioId: generating.id,
              revision: revisionNumber,
              title: generating.title,
              kind,
              markdown: source,
              contentSha256: sha256(source),
              sourceFormat: 'latex',
              figureAssets: usedFigureSnapshots,
            }),
          ),
        );
        this.throwIfCancelled(active);
        const failedCompile = compileResults.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );
        if (failedCompile) throw failedCompile.reason;
      } catch (error) {
        this.throwIfCancelled(active);
        if (error instanceof LectureDocumentCompilerError) {
          throw new LectureStudioServiceError(error.code);
        }
        throw new LectureStudioServiceError('lecture_pdf_compile_failed');
      }
      this.publishProgress(active, 'saving_revision');
      const revisionCreatedAt = this.now().toISOString();
      const artifactInput = {
        outputProjectId: generating.outputProjectId,
        studioId: generating.id,
        studioTitle: generating.title,
        revision: revisionNumber,
        attemptId,
        sourceManifestSha256,
        generationBriefSha256: sha256(JSON.stringify(frozenGenerationBrief)),
        authoringPolicyVersion: LECTURE_STUDIO_AUTHORING_POLICY_VERSION,
        authoringPolicySha256: sha256(LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS),
        documentFormat: 'latex' as const,
        lectureNotesLatex,
        slidesLatex,
        createdAt: revisionCreatedAt,
        invocation,
        figureAssets: usedFigureSnapshots,
        relatedDocuments: [],
        relatedPapers: uniqueNonEmpty(
          sourceManifest.literature
            .map((source) => canonicalDoiUrl(source.doi))
            .filter((value): value is string => value !== null),
          128,
        ),
      } as const;
      pendingArtifactInput = artifactInput;
      const artifacts = await this.saveArtifacts(artifactInput);
      this.publishProgress(active, 'committing_revision');
      const completedAt = this.now().toISOString();
      const revision = LectureStudioRevisionSchema.parse({
        schemaVersion: usedFigureSnapshots.length > 0 ? 4 : 3,
        id: randomUUID(),
        studioId: generating.id,
        revision: revisionNumber,
        attemptId,
        sourceManifest,
        sourceManifestSha256,
        lectureNotesLatex,
        slidesLatex,
        generationBriefSnapshot: frozenGenerationBrief,
        generationBriefSha256: sha256(JSON.stringify(frozenGenerationBrief)),
        authoringPolicyVersion: LECTURE_STUDIO_AUTHORING_POLICY_VERSION,
        authoringPolicySha256: sha256(LECTURE_STUDIO_DEVELOPER_INSTRUCTIONS),
        artifacts,
        invocation,
        ...(usedFigureSnapshots.length > 0
          ? {
              authorship: { kind: 'model' as const },
              figureAssets: usedFigureSnapshots.map((snapshot) => snapshot.asset),
            }
          : {}),
        createdAt: revisionCreatedAt,
      });
      const assistantMessage = LectureStudioMessageSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        studioId: generating.id,
        role: 'assistant',
        status: 'complete',
        content: assistantContent(output.reply, artifacts),
        attemptId,
        revision: revisionNumber,
        invocation,
        createdAt: completedAt,
        completedAt,
      });
      const completedStudio = LectureStudioSchema.parse({
        ...generating,
        status: 'ready',
        activeAttemptId: null,
        currentRevision: revisionNumber,
        version: generating.version + 1,
        lastErrorCode: null,
        updatedAt: completedAt,
      });
      let stored: LectureStudio | null;
      try {
        stored = await this.dependencies.storage.completeLectureStudioTurn({
          studio: completedStudio,
          revision,
          assistantMessage,
        });
      } catch (error) {
        throw this.normalizeStorageError(error);
      }
      if (!stored) throw new LectureStudioServiceError('lecture_persistence_failed');
      pendingArtifactInput = null;
      await Promise.resolve(
        this.dependencies.artifacts.confirmRevisionArtifacts(artifactInput),
      ).catch(() => undefined);
      await preparedAttachments?.commit().catch(() => undefined);
      active.terminal = true;
      this.publish(stored);
      return LectureStudioTurnReceiptSchema.parse({
        studio: stored,
        revision,
        assistantMessage,
      });
    } catch (error) {
      active.terminal = true;
      await preparedAttachments?.rollback().catch(() => undefined);
      if (pendingArtifactInput) {
        await Promise.resolve(
          this.dependencies.artifacts.rollbackRevisionArtifacts(pendingArtifactInput),
        ).catch(() => undefined);
      }
      const normalized = this.normalizeTurnError(error, active);
      let failed: LectureStudio | null = null;
      try {
        failed = await this.dependencies.storage.failLectureStudioTurn({
          studioId: generating.id,
          attemptId,
          errorCode: normalized.code,
          messageStatus: normalized.code === 'lecture_cancelled' ? 'interrupted' : 'failed',
          updatedAt: this.now().toISOString(),
        });
      } catch {
        // Preserve the original bounded turn failure if recovery persistence also fails.
      }
      if (failed) this.publish(failed);
      throw normalized;
    } finally {
      active.terminal = true;
      if (this.activeByStudio.get(generating.id) === active) {
        this.activeByStudio.delete(generating.id);
      }
      if (threadId) {
        this.dependencies.usage?.releaseThread(threadId);
        this.pendingByThread.get(threadId)?.disposeTimers?.();
        this.pendingByThread.delete(threadId);
        this.bufferedByThread.delete(threadId);
        if (turnId && !active.turnTerminal) {
          await this.dependencies.codex.interruptTurn(threadId, turnId).catch(() => undefined);
        }
        await this.dependencies.codex.releaseThread(threadId).catch(() => undefined);
      }
      await materializedFigures?.cleanup().catch(() => undefined);
    }
  }

  private parseRevisionPatchOutput(
    text: string | null,
    currentDraft: Readonly<{
      sourceFormat: 'latex' | 'legacy-markdown';
      lectureNotes: string;
      slides: string;
    }> | null,
    studio: LectureStudio,
    sourceManifest: LectureSourceManifest,
    previousRevision: LectureStudioRevision | null,
    retiredAttachmentLabels: readonly string[],
    documentFeatures: LectureStudioDocumentFeatures,
    availableFigureIds: readonly string[],
  ) {
    if (!text) throw new LectureOutputValidationError('response_json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new LectureOutputValidationError('response_json');
    }
    const result = LectureStudioRevisionPatchOutputSchema.safeParse(parsed);
    if (!result.success || currentDraft?.sourceFormat !== 'latex') {
      throw new LectureOutputValidationError('response_schema');
    }
    let patched: LectureStudioRevisionDraftBodies;
    try {
      patched = applyLectureStudioRevisionPatch(currentDraft, result.data);
    } catch {
      throw new LectureOutputValidationError('response_schema');
    }
    const editedDocuments = new Set(result.data.edits.map((edit) => edit.document));
    return this.parseOutput(
      null,
      studio,
      sourceManifest,
      previousRevision,
      retiredAttachmentLabels,
      documentFeatures,
      {
        availableFigureIds,
        prevalidatedOutput: {
          reply: result.data.reply,
          lectureNotesLatexBody: patched.lectureNotes,
          slidesLatexBody: patched.slides,
        },
        trustedCanonicalBodies: {
          ...(editedDocuments.has('lecture-notes')
            ? {}
            : { 'lecture-notes': currentDraft.lectureNotes }),
          ...(editedDocuments.has('slides') ? {} : { slides: currentDraft.slides }),
        },
      },
    );
  }

  private parseOutput(
    text: string | null,
    studio: LectureStudio,
    sourceManifest: LectureSourceManifest,
    previousRevision: LectureStudioRevision | null,
    retiredAttachmentLabels: readonly string[],
    documentFeatures: LectureStudioDocumentFeatures,
    options: Readonly<{
      availableFigureIds?: readonly string[];
      enforceSlideCount?: boolean;
      prevalidatedOutput?: Readonly<{
        reply: string;
        lectureNotesLatexBody: string;
        slidesLatexBody: string;
      }>;
      trustedCanonicalBodies?: Readonly<Partial<Record<'lecture-notes' | 'slides', string>>>;
    }> = {},
  ) {
    let output: Readonly<{
      reply: string;
      lectureNotesLatexBody: string;
      slidesLatexBody: string;
    }>;
    if (options.prevalidatedOutput) {
      output = options.prevalidatedOutput;
    } else {
      if (!text) throw new LectureOutputValidationError('response_json');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new LectureOutputValidationError('response_json');
      }
      const outputResult = LectureStudioGenerationOutputSchema.safeParse(parsed);
      if (!outputResult.success) throw new LectureOutputValidationError('response_schema');
      output = outputResult.data;
    }
    const latexDiagnostics: LectureOutputLatexDiagnostic[] = [];
    let notesBody: string | null = null;
    let slidesBody: string | null = null;
    try {
      notesBody =
        options.trustedCanonicalBodies?.['lecture-notes'] ??
        validateLectureLatexBody(
          'lecture-notes',
          normalizeGeneratedLectureLatexBody('lecture-notes', output.lectureNotesLatexBody),
          {
            requireSourcesUsed: false,
          },
        );
    } catch (error) {
      if (!(error instanceof LectureLatexSourceError)) throw error;
      latexDiagnostics.push({
        document: 'lecture-notes',
        reason: error.reason,
        tokens: error.tokens,
      });
    }
    try {
      slidesBody =
        options.trustedCanonicalBodies?.slides ??
        validateLectureLatexBody(
          'slides',
          normalizeGeneratedLectureLatexBody('slides', output.slidesLatexBody),
        );
    } catch (error) {
      if (!(error instanceof LectureLatexSourceError)) throw error;
      latexDiagnostics.push({ document: 'slides', reason: error.reason, tokens: error.tokens });
    }
    if (latexDiagnostics.length > 0 || notesBody === null || slidesBody === null) {
      throw new LectureOutputValidationError('latex_grammar', latexDiagnostics);
    }
    const availableFigureIds = new Set(
      (options.availableFigureIds ?? []).map((figureId) => figureId.toLowerCase()),
    );
    const notesFigureIds = findLectureFigureAssetIds(notesBody);
    const slidesFigureIds = findLectureFigureAssetIds(slidesBody);
    const unknownFigureDocuments = [
      ['lecture-notes', notesFigureIds] as const,
      ['slides', slidesFigureIds] as const,
    ].filter(([, figureIds]) =>
      figureIds.some((figureId) => !availableFigureIds.has(figureId.toLowerCase())),
    );
    if (unknownFigureDocuments.length > 0) {
      throw new LectureOutputValidationError(
        'latex_grammar',
        unknownFigureDocuments.map(([document]) => ({
          document,
          reason: 'invalid_figure_reference',
          tokens: [],
        })),
      );
    }
    if (
      notesBody.includes(LECTURE_STUDIO_RETIRED_TURN_ATTACHMENT_CITATION_MARKER) ||
      slidesBody.includes(LECTURE_STUDIO_RETIRED_TURN_ATTACHMENT_CITATION_MARKER)
    ) {
      throw new LectureOutputValidationError('citation_mapping');
    }
    if (
      unchangedDraftRetainsRetiredAttachmentCitation(
        previousRevision,
        retiredAttachmentLabels,
        notesBody,
        slidesBody,
      )
    ) {
      throw new LectureOutputValidationError('citation_mapping');
    }
    if (
      UNSUPPORTED_CITATION_PATTERN.test(notesBody) ||
      UNSUPPORTED_CITATION_PATTERN.test(slidesBody)
    ) {
      throw new LectureOutputValidationError('citation_mapping');
    }
    const manuscriptSources = sourceManifest.schemaVersion === 1 ? [] : sourceManifest.manuscripts;
    const externalSources =
      sourceManifest.schemaVersion === 3 || sourceManifest.schemaVersion === 4
        ? sourceManifest.externalSources
        : [];
    const turnAttachments =
      sourceManifest.schemaVersion === 4 ? sourceManifest.turnAttachments : [];
    const allowedLabels = new Set([
      ...sourceManifest.literature.map((source) => source.sourceLabel),
      ...sourceManifest.experiments.map((source) => source.sourceLabel),
      ...manuscriptSources.map((source) => source.sourceLabel),
      ...externalSources.map((source) => source.sourceLabel),
      ...turnAttachments.map((source) => source.sourceLabel),
    ]);
    const evidenceLikeCitations = [
      ...`${notesBody}\n${slidesBody}`.matchAll(EVIDENCE_LIKE_CITATION_PATTERN),
    ].map((match) => match[1]!);
    if (evidenceLikeCitations.some((label) => !allowedLabels.has(label))) {
      throw new LectureOutputValidationError('citation_mapping');
    }
    const sourceListSections = findLectureSourceListSections(notesBody);
    const canonicalSourceListSections = sourceListSections.filter((section) => section.isCanonical);
    const grandfatheredSourceListAliases = customLectureSourceListAliasTitles(
      studio.generationBrief,
    );
    const enforcedSourceListSections = sourceListSections.filter(
      (section) => section.isCanonical || !grandfatheredSourceListAliases.has(section.title),
    );
    const sourcesHeading = canonicalSourceListSections[0] ?? null;
    const notesEvidenceBody = sourcesHeading ? notesBody.slice(0, sourcesHeading.index) : notesBody;
    const allCitations = [
      ...`${notesBody}\n${slidesBody}`.matchAll(/\[((?:P|E|M|F|A)\d+)\]/gu),
    ].map((match) => match[1]!);
    if (allCitations.some((label) => !allowedLabels.has(label))) {
      throw new LectureOutputValidationError('citation_mapping');
    }
    const usedLabels = new Set<string>();
    for (const latex of [notesEvidenceBody, slidesBody]) {
      const citations = [...latex.matchAll(/\[((?:P|E|M|F|A)\d+)\]/gu)].map((match) => match[1]!);
      if (citations.length === 0) {
        throw new LectureOutputValidationError('citation_mapping');
      }
      for (const label of citations) usedLabels.add(label);
    }
    const hasValidSourceListConfiguration = documentFeatures.includeSourcesUsedSection
      ? enforcedSourceListSections.length === 1 &&
        canonicalSourceListSections.length === 1 &&
        sourcesHeading?.isTerminal === true
      : enforcedSourceListSections.length === 0;
    if (!hasValidSourceListConfiguration) {
      throw new LectureOutputValidationError('citation_mapping');
    }
    if (sourcesHeading) {
      const sourcesSection = notesBody.slice(sourcesHeading.end);
      if ([...usedLabels].some((label) => !sourcesSectionMapsLabel(sourcesSection, label))) {
        throw new LectureOutputValidationError('citation_mapping');
      }
    }
    const slides = [
      ...slidesBody.matchAll(/\\begin\s*\{\s*frame\s*\}[\s\S]*?\\end\s*\{\s*frame\s*\}/gu),
    ].map((match) => match[0]);
    for (const slide of slides) {
      const citations = [...slide.matchAll(/\[((?:P|E|M|F|A)\d+)\]/gu)].map((match) => match[1]!);
      if (citations.length === 0 || citations.some((label) => !allowedLabels.has(label))) {
        throw new LectureOutputValidationError('citation_mapping');
      }
    }
    if ((options.enforceSlideCount ?? true) && studio.kind === 'talk') {
      const requestedSlides = studio.generationBrief.slidesTargetPages;
      if (
        requestedSlides !== null &&
        countLectureSlidePages(slidesBody, documentFeatures) !== requestedSlides
      ) {
        throw new LectureOutputValidationError('slide_count');
      }
      const budget = talkSlideBudget(studio.durationMinutes!);
      const slideCount = countLectureSlidePages(slidesBody, documentFeatures);
      if (
        requestedSlides === null &&
        (slideCount < budget.minimum || slideCount > budget.maximum)
      ) {
        throw new LectureOutputValidationError('slide_count');
      }
    } else if (
      (options.enforceSlideCount ?? true) &&
      studio.generationBrief.slidesTargetPages !== null &&
      countLectureSlidePages(slidesBody, documentFeatures) !==
        studio.generationBrief.slidesTargetPages
    ) {
      throw new LectureOutputValidationError('slide_count');
    }
    return {
      ...output,
      lectureNotesLatexBody: notesBody,
      slidesLatexBody: slidesBody,
      figureIds: [...new Set([...notesFigureIds, ...slidesFigureIds])],
    };
  }

  private async saveArtifacts(
    input: Parameters<LectureStudioArtifactWriter['saveRevisionArtifacts']>[0],
  ) {
    try {
      return await this.dependencies.artifacts.saveRevisionArtifacts(input);
    } catch (error) {
      if (
        isRecord(error) &&
        (error.code === 'research_notes_vault_not_selected' ||
          error.code === 'research_notes_folder_unavailable' ||
          error.message === 'research_notes_vault_not_selected' ||
          error.message === 'research_notes_folder_unavailable')
      ) {
        throw new LectureStudioServiceError('lecture_research_notes_required');
      }
      throw new LectureStudioServiceError('lecture_persistence_failed');
    }
  }

  private async reconcilePendingArtifactsOnce() {
    const pendingBundles = await this.dependencies.artifacts.listPendingRevisionArtifacts();
    for (const pending of pendingBundles) {
      let studio: LectureStudio | null;
      let revision: LectureStudioRevision | null;
      try {
        [studio, revision] = await Promise.all([
          this.dependencies.storage.getLectureStudio(pending.studioId),
          this.dependencies.storage.getLectureStudioRevision(pending.studioId, pending.revision),
        ]);
      } catch {
        continue;
      }

      if (
        studio?.status === 'generating' &&
        studio.activeAttemptId === pending.attemptId &&
        studio.currentRevision + 1 === pending.revision &&
        studio.outputProjectId === pending.outputProjectId
      ) {
        continue;
      }

      if (studio && revision && committedRevisionMatchesPending(studio, revision, pending)) {
        await Promise.resolve(
          this.dependencies.artifacts.confirmPendingRevisionArtifacts(pending),
        ).catch(() => undefined);
        continue;
      }

      if (
        revision &&
        revision.artifacts.some((artifact) => pendingArtifactPath(pending, artifact))
      ) {
        // A committed row references this path but its identity/hash disagrees. Preserve it for repair.
        continue;
      }
      await Promise.resolve(
        this.dependencies.artifacts.rollbackPendingRevisionArtifacts(pending),
      ).catch(() => undefined);
    }
  }

  private normalizeArtifactError(error: unknown) {
    if (
      isRecord(error) &&
      (error.code === 'research_notes_vault_not_selected' ||
        error.code === 'research_notes_folder_unavailable' ||
        error.code === 'research_notes_vault_changed' ||
        error.message === 'research_notes_vault_not_selected' ||
        error.message === 'research_notes_folder_unavailable' ||
        error.message === 'research_notes_vault_changed')
    ) {
      return new LectureStudioServiceError('lecture_research_notes_required');
    }
    return new LectureStudioServiceError('lecture_persistence_failed');
  }

  private normalizeStorageError(error: unknown) {
    if (error instanceof LectureStudioStorageError) {
      if (error.code === 'capacity_reached') {
        return new LectureStudioServiceError('lecture_capacity_reached');
      }
      if (error.code === 'trash_changed') {
        return new LectureStudioServiceError('lecture_trash_changed');
      }
    }
    return new LectureStudioServiceError('lecture_persistence_failed');
  }

  private normalizeTurnError(error: unknown, active: ActiveExecution) {
    if (active.cancelRequested) return new LectureStudioServiceError('lecture_cancelled');
    if (error instanceof LectureStudioServiceError) return error;
    if (
      error instanceof Error &&
      (error.message === 'lecture_studio_prompt_budget_exceeded' ||
        error.message === 'lecture_studio_source_context_too_large')
    ) {
      return new LectureStudioServiceError('lecture_context_too_large');
    }
    if (
      isRecord(error) &&
      (error.code === 'research_notes_vault_not_selected' ||
        error.code === 'research_notes_folder_unavailable' ||
        error.message === 'research_notes_vault_not_selected')
    ) {
      return new LectureStudioServiceError('lecture_research_notes_required');
    }
    return new LectureStudioServiceError('lecture_generation_failed');
  }

  private throwIfCancelled(active: ActiveExecution) {
    if (active.cancelRequested) throw new LectureStudioServiceError('lecture_cancelled');
  }

  private async requireStudio(studioId: string) {
    const studio = await this.dependencies.storage.getLectureStudio(studioId);
    if (!studio) throw new LectureStudioServiceError('lecture_studio_not_found');
    if (studio.trashedAt) throw new LectureStudioServiceError('lecture_studio_trashed');
    return LectureStudioSchema.parse(studio);
  }

  private async requireActiveProjects(projectIds: readonly string[]) {
    const snapshot = await this.dependencies.workspace.snapshot();
    const byId = new Map(snapshot.projects.map((project) => [project.id, project]));
    const projects: ProjectRecord[] = [];
    for (const projectId of projectIds) {
      const project = byId.get(projectId);
      if (!project || project.archivedAt || project.trashedAt) {
        throw new LectureStudioServiceError('lecture_source_not_found');
      }
      projects.push(project);
    }
    return projects;
  }

  private async resolveSourceManifest(
    projectIds: readonly string[],
    selection: LectureSourceSelection,
    studioId?: string,
    outputProjectId?: string,
  ): Promise<LectureSourceManifest> {
    const activeProjects = await this.requireActiveProjects(projectIds);
    const projects = new Map(activeProjects.map((project) => [project.id, project]));
    const records = new Map<string, LiteratureRecord>();
    const ideas = new Map<string, ExperimentIdea>();
    const metricsByIdea = new Map<string, ExperimentMetricPoint[]>();
    const manuscriptExtractBudgetByIdentity = new Map<string, number>();
    const externalSelection = selection.externalSources;
    if (
      externalSelection &&
      (!studioId || !outputProjectId || !projectIds.includes(outputProjectId))
    ) {
      throw new LectureStudioServiceError('lecture_source_conflict');
    }
    const externalSources = externalSelection
      ? await this.dependencies.externalSources
          .snapshots({
            projectId: outputProjectId!,
            studioId: studioId!,
            sourceIds: externalSelection.sourceIds,
          })
          .catch(() => {
            throw new LectureStudioServiceError('lecture_source_conflict');
          })
      : [];
    const externalExtractJsonCharacters = externalSources.reduce(
      (total, source) => total + JSON.stringify(source.extraction.content).length,
      0,
    );
    const manuscriptTotalExtractBudget = Math.max(
      0,
      LECTURE_MANUSCRIPT_TOTAL_EXTRACT_MAX_JSON_CHARACTERS - externalExtractJsonCharacters,
    );
    if (
      selection.manuscripts.length > 0 &&
      manuscriptTotalExtractBudget < selection.manuscripts.length * JSON.stringify('').length
    ) {
      throw new LectureStudioServiceError('lecture_context_too_large');
    }
    if (selection.manuscripts.length > 0) {
      const fairShare = Math.floor(manuscriptTotalExtractBudget / selection.manuscripts.length);
      let remainder = manuscriptTotalExtractBudget - fairShare * selection.manuscripts.length;
      for (const reference of selection.manuscripts) {
        manuscriptExtractBudgetByIdentity.set(
          `${reference.projectId}:${reference.manuscriptId}`,
          fairShare + (remainder-- > 0 ? 1 : 0),
        );
      }
    }
    const manuscripts = new Map<
      string,
      Awaited<ReturnType<LectureStudioService['resolveManuscriptSource']>>
    >();
    await Promise.all(
      activeProjects.map(async (project) => {
        const recordIds = selection.literature
          .filter((reference) => reference.projectId === project.id)
          .map((reference) => reference.recordId);
        const ideaIds = selection.experiments
          .filter((reference) => reference.projectId === project.id)
          .map((reference) => reference.ideaId);
        const manuscriptIds = selection.manuscripts
          .filter((reference) => reference.projectId === project.id)
          .map((reference) => reference.manuscriptId);
        const [projectRecords, projectIdeas, projectMetricTails, projectManuscripts] =
          await Promise.all([
            recordIds.length > 0
              ? this.dependencies.sources.getLiteratureRecordsByIds(project.id, recordIds)
              : Promise.resolve([]),
            Promise.all(
              ideaIds.map((ideaId) =>
                this.dependencies.sources.getExperimentIdea(project.id, ideaId),
              ),
            ),
            ideaIds.length > 0
              ? this.dependencies.sources.listExperimentMetricTails({
                  projectId: project.id,
                  ideaIds,
                  perIdeaLimit: LECTURE_STUDIO_MAX_METRICS_PER_IDEA,
                })
              : Promise.resolve([]),
            Promise.all(
              manuscriptIds.map((manuscriptId) => {
                const identity = `${project.id}:${manuscriptId}`;
                const extractBudget = manuscriptExtractBudgetByIdentity.get(identity);
                if (extractBudget === undefined) {
                  throw new LectureStudioServiceError('lecture_source_conflict');
                }
                return this.resolveManuscriptSource(project.id, manuscriptId, extractBudget);
              }),
            ),
          ]);
        const expectedRecordIds = new Set(recordIds);
        for (const record of projectRecords) {
          if (record.projectId !== project.id || !expectedRecordIds.has(record.id)) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          records.set(`${project.id}:${record.id}`, record);
        }
        if (recordIds.some((recordId) => !records.has(`${project.id}:${recordId}`))) {
          throw new LectureStudioServiceError('lecture_source_not_found');
        }
        for (const [index, idea] of projectIdeas.entries()) {
          if (!idea) throw new LectureStudioServiceError('lecture_source_not_found');
          const expectedIdeaId = ideaIds[index]!;
          if (idea.projectId !== project.id || idea.id !== expectedIdeaId) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          ideas.set(`${project.id}:${idea.id}`, idea);
        }
        const selectedIdeaIds = new Set(ideaIds);
        const returnedMetricIdeaIds = new Set<string>();
        for (const tail of projectMetricTails) {
          if (!selectedIdeaIds.has(tail.ideaId) || returnedMetricIdeaIds.has(tail.ideaId)) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          returnedMetricIdeaIds.add(tail.ideaId);
          const points = [...tail.metricPoints].sort(
            (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
          );
          if (
            points.length > LECTURE_STUDIO_MAX_METRICS_PER_IDEA ||
            tail.metricPointTotal < points.length ||
            points.some((point) => point.projectId !== project.id || point.ideaId !== tail.ideaId)
          ) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          metricsByIdea.set(`${project.id}:${tail.ideaId}`, points);
        }
        for (const [index, manuscript] of projectManuscripts.entries()) {
          const manuscriptId = manuscriptIds[index]!;
          if (
            manuscript.projectId !== project.id ||
            manuscript.manuscriptId !== manuscriptId ||
            manuscripts.has(`${project.id}:${manuscriptId}`)
          ) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          manuscripts.set(`${project.id}:${manuscriptId}`, manuscript);
        }
      }),
    );
    const literature = selection.literature.map((reference, index) => {
      const project = projects.get(reference.projectId);
      const record = records.get(`${reference.projectId}:${reference.recordId}`);
      if (!project || !record) throw new LectureStudioServiceError('lecture_source_not_found');
      if (record.reviewStatus === 'excluded') {
        throw new LectureStudioServiceError('lecture_source_conflict');
      }
      return {
        sourceLabel: `P${index + 1}`,
        projectId: project.id,
        projectName: project.name,
        recordId: record.id,
        recordVersion: record.version,
        annotationVersion: record.annotationVersion,
        title: record.title,
        authors: record.authors,
        containerTitle: record.containerTitle,
        publishedYear: record.publishedYear,
        doi: record.doi,
        citationKey: record.citationKey.trim() || null,
        reviewStatus: record.reviewStatus,
        topics: uniqueNonEmpty(
          [
            ...record.manualAnnotations.topics,
            ...record.sourceTopics,
            ...(record.aiAnnotations?.topics ?? []),
          ],
          40,
        ),
        metadataSummary: (
          record.manualAnnotations.summary.trim() ||
          record.aiAnnotations?.summary.trim() ||
          ''
        ).slice(0, 1_200),
        metadataOnly: true as const,
      };
    });
    const experiments = selection.experiments.map((reference, index) => {
      const project = projects.get(reference.projectId);
      const idea = ideas.get(`${reference.projectId}:${reference.ideaId}`);
      if (!project || !idea) {
        throw new LectureStudioServiceError('lecture_source_not_found');
      }
      return {
        sourceLabel: `E${index + 1}`,
        projectId: project.id,
        projectName: project.name,
        ideaId: idea.id,
        ideaVersion: idea.version,
        parentIdeaId: idea.parentIdeaId,
        title: idea.title,
        hypothesis: idea.hypothesis,
        phase: idea.phase,
        outcome: idea.outcome,
        resultSummary: idea.resultSummary,
        metrics: (metricsByIdea.get(`${reference.projectId}:${reference.ideaId}`) ?? [])
          .slice()
          .sort((left, right) => left.sequence - right.sequence)
          .slice(-LECTURE_STUDIO_MAX_METRICS_PER_IDEA)
          .map((point) => ({
            sequence: point.sequence,
            objectiveId: point.objectiveId,
            objectiveVersion: point.objectiveVersion,
            metricKey: point.metricKey,
            metricDisplayName: point.metricDisplayName,
            direction: point.direction,
            unit: point.unit,
            aggregation: point.aggregation,
            evaluatorHash: point.evaluatorHash,
            datasetHash: point.datasetHash,
            holdoutHash: point.holdoutHash,
            baseline: point.baseline,
            target: point.target,
            value: point.value,
            trialId: point.trialId,
            recordedAt: point.recordedAt,
          })),
      };
    });
    const manuscriptSources = selection.manuscripts.map((reference, index) => {
      const project = projects.get(reference.projectId);
      const manuscript = manuscripts.get(`${reference.projectId}:${reference.manuscriptId}`);
      if (!project || !manuscript) {
        throw new LectureStudioServiceError('lecture_source_not_found');
      }
      return {
        sourceLabel: `M${index + 1}`,
        projectName: project.name,
        ...manuscript,
      };
    });
    const manuscriptExtractJsonCharacters = manuscriptSources.reduce(
      (sourceTotal, manuscript) =>
        sourceTotal +
        manuscript.files.reduce(
          (fileTotal, file) => fileTotal + JSON.stringify(file.content).length,
          0,
        ),
      0,
    );
    if (manuscriptExtractJsonCharacters > manuscriptTotalExtractBudget) {
      throw new LectureStudioServiceError('lecture_context_too_large');
    }
    let manifest: LectureSourceManifest;
    try {
      manifest = LectureSourceManifestSchema.parse({
        // Keep historical non-file revisions on v1 and captured-manuscript-only revisions on v2.
        // External frozen files opt into v3 without changing either earlier manifest hash format.
        schemaVersion: externalSources.length > 0 ? 3 : manuscriptSources.length > 0 ? 2 : 1,
        selectedProjectIds: projectIds,
        literature,
        experiments,
        ...(manuscriptSources.length > 0 ? { manuscripts: manuscriptSources } : {}),
        ...(externalSources.length > 0 ? { manuscripts: manuscriptSources, externalSources } : {}),
      });
    } catch {
      throw new LectureStudioServiceError('lecture_source_conflict');
    }
    if (JSON.stringify(manifest).length > LECTURE_STUDIO_SOURCE_MANIFEST_MAX_CHARACTERS) {
      throw new LectureStudioServiceError('lecture_context_too_large');
    }
    return manifest;
  }

  private async resolveManuscriptSource(
    projectId: string,
    manuscriptId: string,
    extractJsonCharacterBudget: number,
  ) {
    try {
      const snapshot = await this.dependencies.manuscripts.list({ projectId });
      if (snapshot.projectId !== projectId) {
        throw new LectureStudioServiceError('lecture_source_conflict');
      }
      const item = snapshot.manuscripts.find(
        (candidate) =>
          candidate.manuscript.id === manuscriptId && candidate.manuscript.projectId === projectId,
      );
      if (!item) throw new LectureStudioServiceError('lecture_source_not_found');
      const { manuscript, connection } = item;
      const checkpoint =
        connection?.binding.enabled === true &&
        connection.binding.projectId === projectId &&
        connection.binding.manuscriptId === manuscriptId &&
        connection.lastCheckpoint?.bindingId === connection.binding.bindingId &&
        connection.lastCheckpoint.projectId === projectId &&
        connection.lastCheckpoint.manuscriptId === manuscriptId &&
        connection.lastCheckpoint.providerId === connection.binding.providerId &&
        connection.lastCheckpoint.rootDocument === manuscript.rootDocument
          ? connection.lastCheckpoint
          : null;
      if (!connection || !checkpoint) {
        throw new LectureStudioServiceError('lecture_source_not_found');
      }

      const fileList = await this.dependencies.manuscripts.listCheckpointFiles({
        projectId,
        manuscriptId,
        checkpointId: checkpoint.checkpointId,
      });
      if (
        fileList.projectId !== projectId ||
        fileList.manuscriptId !== manuscriptId ||
        fileList.checkpointId !== checkpoint.checkpointId ||
        fileList.providerRevision !== (checkpoint.providerRevision ?? checkpoint.sourceRevision)
      ) {
        throw new LectureStudioServiceError('lecture_source_conflict');
      }
      const sourceFiles = fileList.files
        .filter(
          ({ relativePath, textReadable }) =>
            textReadable && LECTURE_MANUSCRIPT_SOURCE_PATH_PATTERN.test(relativePath),
        )
        .sort((left, right) => {
          if (left.relativePath === manuscript.rootDocument) return -1;
          if (right.relativePath === manuscript.rootDocument) return 1;
          return left.relativePath.localeCompare(right.relativePath, 'en-US');
        });
      if (
        sourceFiles.length === 0 ||
        sourceFiles.length > LECTURE_STUDIO_MAX_MANUSCRIPT_FILES ||
        new Set(sourceFiles.map(({ relativePath }) => relativePath)).size !== sourceFiles.length ||
        !sourceFiles.some(({ relativePath }) => relativePath === manuscript.rootDocument)
      ) {
        throw new LectureStudioServiceError('lecture_context_too_large');
      }

      const fullFiles: Array<{ relativePath: string; content: string }> = [];
      let totalSourceCharacters = 0;
      for (const { relativePath } of sourceFiles) {
        const chunks: string[] = [];
        let offset = 0;
        for (;;) {
          const chunk = await this.dependencies.manuscripts.readCheckpointFile({
            projectId,
            manuscriptId,
            checkpointId: checkpoint.checkpointId,
            relativePath,
            offset,
            maxCharacters: LECTURE_MANUSCRIPT_FILE_MAX_CHARACTERS,
          });
          if (
            chunk.projectId !== projectId ||
            chunk.manuscriptId !== manuscriptId ||
            chunk.checkpointId !== checkpoint.checkpointId ||
            chunk.providerRevision !== fileList.providerRevision ||
            chunk.relativePath !== relativePath ||
            chunk.offset !== offset ||
            chunk.nextOffset !== offset + chunk.content.length ||
            (chunk.truncated && chunk.nextOffset <= offset)
          ) {
            throw new LectureStudioServiceError('lecture_source_conflict');
          }
          chunks.push(chunk.content);
          totalSourceCharacters += chunk.content.length;
          if (totalSourceCharacters > 2_000_000) {
            throw new LectureStudioServiceError('lecture_context_too_large');
          }
          offset = chunk.nextOffset;
          if (!chunk.truncated) break;
        }
        fullFiles.push({ relativePath, content: chunks.join('') });
      }

      let remainingExtractJsonCharacters = extractJsonCharacterBudget;
      if (remainingExtractJsonCharacters < fullFiles.length * JSON.stringify('').length) {
        throw new LectureStudioServiceError('lecture_context_too_large');
      }
      const files = fullFiles.map(({ relativePath, content }, index) => {
        // Files are root-first. Give the current file every remaining byte after reserving the
        // smallest valid JSON string for each later file, so provenance stays complete without
        // allowing a large bibliography to steal another manuscript's fair source share.
        const futureMinimum = (fullFiles.length - index - 1) * JSON.stringify('').length;
        const availableJsonCharacters = remainingExtractJsonCharacters - futureMinimum;
        const perFileMaximum =
          relativePath === manuscript.rootDocument
            ? LECTURE_MANUSCRIPT_FILE_EXTRACT_MAX_CHARACTERS
            : LECTURE_MANUSCRIPT_FILE_MAX_CHARACTERS;
        const extracted = boundedExactFileExtractToJsonBudget(
          content,
          Math.min(availableJsonCharacters, perFileMaximum),
        );
        remainingExtractJsonCharacters -= JSON.stringify(extracted).length;
        return {
          relativePath,
          contentSha256: sha256(content),
          totalCharacters: content.length,
          contentComplete: extracted.length === content.length,
          extractionPolicyVersion: 1 as const,
          content: extracted,
        };
      });
      return {
        projectId,
        manuscriptId,
        manuscriptVersion: manuscript.version,
        title: manuscript.title,
        rootDocument: manuscript.rootDocument,
        checkpointId: checkpoint.checkpointId,
        providerId: checkpoint.providerId,
        providerRevision: checkpoint.providerRevision ?? checkpoint.sourceRevision,
        revisionEnvelopeDigest: checkpoint.revisionEnvelopeDigest,
        observedAt: checkpoint.observedAt,
        files,
        contentKind: 'captured_latex' as const,
        metadataOnly: false as const,
      };
    } catch (error) {
      if (error instanceof LectureStudioServiceError) throw error;
      throw new LectureStudioServiceError('lecture_source_conflict');
    }
  }

  private publish(studio: LectureStudio) {
    const event = LectureStudioEventSchema.parse({
      schemaVersion: 1,
      type: 'lecture.studio.changed',
      studioId: studio.id,
      status: studio.status,
      activeAttemptId: studio.activeAttemptId,
      version: studio.version,
      occurredAt: studio.updatedAt,
    });
    for (const listener of this.listeners) listener(event);
  }

  private publishProgress(
    active: ActiveExecution,
    phase: LectureGenerationProgressPhase,
    throttleActivity = false,
  ) {
    if (
      this.activeByStudio.get(active.studioId) !== active ||
      active.cancelRequested ||
      active.terminal
    ) {
      return;
    }
    const monotonicNow = Date.now();
    if (throttleActivity && monotonicNow - active.lastActivityProgressAt < 5_000) return;
    if (throttleActivity) active.lastActivityProgressAt = monotonicNow;
    active.progressSequence += 1;
    const occurredAt = this.now().toISOString();
    const event = LectureStudioEventSchema.parse({
      schemaVersion: 1,
      type: 'lecture.generation.progress',
      studioId: active.studioId,
      attemptId: active.attemptId,
      phase,
      sequence: active.progressSequence,
      startedAt: active.startedAt,
      occurredAt,
    });
    void this.recordAttemptBestEffort(() =>
      this.dependencies.storage.recordLectureStudioAttemptPhase(active.studioId, active.attemptId, {
        phase,
        sequence: active.progressSequence,
        occurredAt,
      }),
    );
    for (const listener of this.listeners) listener(event);
  }

  private async recordAttemptBestEffort(operation: () => MaybePromise<unknown>) {
    try {
      await operation();
    } catch {
      // Diagnostics must never block or strand the generation they describe.
    }
  }

  private throwIfProjectsLifecycleLocked(projectIds: readonly string[]) {
    if (projectIds.some((projectId) => this.lifecycleLockedProjects.has(projectId))) {
      throw new LectureStudioServiceError('lecture_busy');
    }
  }

  private studioTouchesProjects(studio: LectureStudio, projectIds: ReadonlySet<string>) {
    return (
      projectIds.has(studio.outputProjectId) ||
      studio.sourceProjectIds.some((projectId) => projectIds.has(projectId))
    );
  }

  private now() {
    return this.dependencies.now?.() ?? new Date();
  }

  private routeNotification(notification: CodexNotification) {
    const identity = notificationIdentity(notification);
    if (!identity) return;
    const pending = this.pendingByThread.get(identity.threadId);
    if (!pending) return;
    if (pending.turnId === null) {
      // This private modality notification can race the runTurn() response that supplies the
      // turn id. Preserve it immediately so a following transport disconnect cannot downgrade
      // the actionable figure/model error to a generic Codex-unavailable failure.
      if (notification.method === 'gosu/attachment-model-modality-rejected') {
        pending.nativeImageRejected = true;
      }
      const buffered = this.bufferedByThread.get(identity.threadId) ?? [];
      if (buffered.length < 100) buffered.push(notification);
      this.bufferedByThread.set(identity.threadId, buffered);
      return;
    }
    if (pending.turnId !== identity.turnId) return;
    this.processNotification(pending, notification);
  }

  private processNotification(pending: PendingTurn, notification: CodexNotification) {
    if (pending.terminal || !isRecord(notification.params)) return;
    const identity = notificationIdentity(notification);
    if (!identity || identity.threadId !== pending.threadId || identity.turnId !== pending.turnId) {
      return;
    }
    pending.markActivity?.();
    if (notification.method === 'gosu/attachment-model-modality-rejected') {
      pending.nativeImageRejected = true;
      return;
    }
    if (notification.method === 'item/completed') {
      const item = notification.params.item;
      if (
        isRecord(item) &&
        item.type === 'agentMessage' &&
        item.phase !== 'commentary' &&
        typeof item.text === 'string'
      ) {
        pending.finalText = item.text;
      }
      return;
    }
    if (notification.method !== 'turn/completed') return;
    const turn = notification.params.turn;
    pending.terminal = true;
    pending.resolve({
      status: isRecord(turn) && typeof turn.status === 'string' ? turn.status : 'failed',
      text: pending.finalText,
      failureCode:
        pending.nativeImageRejected ||
        notification.params.gosuErrorCode === 'attachment_model_modality_unsupported'
          ? 'lecture_figure_model_unsupported'
          : classifyCodexTurnFailure(turn),
    });
  }
}
