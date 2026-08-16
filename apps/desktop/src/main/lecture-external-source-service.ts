import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

import { z } from 'zod';

import {
  ClaimLectureExternalSourceSetInputSchema,
  DiscardLectureExternalSourceSetInputSchema,
  LECTURE_EXTERNAL_SOURCE_MAX_BYTES,
  LECTURE_EXTERNAL_SOURCE_MAX_EXTRACTED_CHARACTERS,
  LECTURE_EXTERNAL_SOURCE_MAX_SOURCES,
  LECTURE_EXTERNAL_SOURCE_MAX_TOTAL_BYTES,
  LECTURE_EXTERNAL_SOURCE_MAX_TOTAL_EXTRACTED_CHARACTERS,
  LECTURE_EXTERNAL_SOURCE_SET_TTL_MS,
  LectureExternalSourceListSchema,
  LectureExternalSourceListViewSchema,
  LectureExternalSourceScopeInputSchema,
  LectureExternalSourceSchema,
  ListStagedLectureExternalSourcesInputSchema,
  LectureExternalSourceSnapshotSchema,
  RemoveLectureExternalSourceInputSchema,
  RemoveStagedLectureExternalSourceInputSchema,
  SnapshotLectureExternalSourcesInputSchema,
  SnapshotStagedLectureExternalSourcesInputSchema,
  StageLectureExternalSourcesInputSchema,
  StagedLectureExternalSourceSchema,
  StagedLectureExternalSourceSetSchema,
  StagedLectureExternalSourceSetViewSchema,
  type ClaimLectureExternalSourceSetInput,
  type DiscardLectureExternalSourceSetInput,
  type LectureExternalSource,
  type LectureExternalSourceKind,
  type LectureExternalSourceList,
  type LectureExternalSourceScopeInput,
  type ListStagedLectureExternalSourcesInput,
  type LectureExternalSourceSnapshot,
  type RemoveLectureExternalSourceInput,
  type RemoveStagedLectureExternalSourceInput,
  type SnapshotLectureExternalSourcesInput,
  type SnapshotStagedLectureExternalSourcesInput,
  type StageLectureExternalSourcesInput,
  type StagedLectureExternalSource,
  type StagedLectureExternalSourceSet,
} from '../shared/lecture-external-source-contracts';
import {
  extractProjectChatPdf,
  ProjectChatPdfExtractionError,
  type ExtractedProjectChatPdf,
} from './project-chat-pdf-extractor';

const MANIFEST_FILE = 'sources-v1.json';
const MANIFEST_AUTHENTICATION_KEY_FILE = 'manifest-authentication-key.bin';
const MAX_MANIFEST_PAYLOAD_BYTES = 2_000_000;
const MAX_MANIFEST_ENVELOPE_BYTES = 2_100_000;
const MAX_OWNED_STUDIO_SOURCE_DIRECTORIES = 1_100;

const AuthenticatedManifestEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    payloadJson: z.string().min(2).max(MAX_MANIFEST_PAYLOAD_BYTES),
    authentication: z
      .object({
        scheme: z.literal('hmac-sha256'),
        keyVersion: z.literal(1),
        tag: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
  })
  .strict();

type LectureExternalSourceSecureStorage = Readonly<{
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}>;

export class LectureExternalSourceManifestAuthenticator {
  private keyHex: Promise<string> | null = null;

  constructor(
    private readonly dependencies: Readonly<{
      rootDirectory: () => string;
      encryption: LectureExternalSourceSecureStorage;
    }>,
  ) {}

  async seal(payloadJson: string) {
    if (Buffer.byteLength(payloadJson, 'utf8') > MAX_MANIFEST_PAYLOAD_BYTES) {
      throw new LectureExternalSourceError('lecture_external_source_corrupt');
    }
    return {
      scheme: 'hmac-sha256' as const,
      keyVersion: 1 as const,
      tag: await this.tagV1(payloadJson),
    };
  }

  async verify(
    payloadJson: string,
    authentication: z.infer<typeof AuthenticatedManifestEnvelopeSchema>['authentication'],
  ) {
    // This explicit dispatch is the compatibility boundary. A future key or algorithm version must
    // add a verifier; it must never silently reinterpret an existing authenticated manifest.
    if (authentication.scheme !== 'hmac-sha256' || authentication.keyVersion !== 1) return false;
    const expected = Buffer.from(await this.tagV1(payloadJson), 'hex');
    const received = Buffer.from(authentication.tag, 'hex');
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private async tagV1(payloadJson: string) {
    const key = Buffer.from(await this.readKeyHex(), 'hex');
    try {
      return createHmac('sha256', key).update(payloadJson, 'utf8').digest('hex');
    } finally {
      key.fill(0);
    }
  }

  private readKeyHex() {
    if (!this.keyHex) {
      this.keyHex = this.loadOrCreateKey().catch((error) => {
        this.keyHex = null;
        throw error;
      });
    }
    return this.keyHex;
  }

  private async loadOrCreateKey() {
    const { encryption } = this.dependencies;
    if (!encryption.isEncryptionAvailable()) {
      throw new LectureExternalSourceError('lecture_external_source_corrupt');
    }
    const root = resolve(this.dependencies.rootDirectory());
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    const keyPath = join(root, MANIFEST_AUTHENTICATION_KEY_FILE);
    let sealed: Buffer;
    try {
      sealed = await readFile(keyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new LectureExternalSourceError('lecture_external_source_corrupt');
      }
      const key = randomBytes(32);
      const temporary = join(root, `.manifest-key-${randomUUID()}.tmp`);
      try {
        sealed = encryption.encryptString(key.toString('hex'));
        await writeFile(temporary, sealed, { flag: 'wx', mode: 0o600 });
        await rename(temporary, keyPath);
      } catch {
        throw new LectureExternalSourceError('lecture_external_source_corrupt');
      } finally {
        key.fill(0);
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    }
    try {
      const keyHex = encryption.decryptString(sealed).trim();
      if (!/^[a-f0-9]{64}$/u.test(keyHex)) {
        throw new LectureExternalSourceError('lecture_external_source_corrupt');
      }
      return keyHex;
    } catch (error) {
      if (error instanceof LectureExternalSourceError) throw error;
      throw new LectureExternalSourceError('lecture_external_source_corrupt');
    }
  }
}

type FormatDefinition = Readonly<{
  kind: LectureExternalSourceKind;
  mediaType: LectureExternalSource['mediaType'];
  suffix: '.tex' | '.md' | '.pdf';
}>;

const FORMATS: Readonly<Record<string, FormatDefinition>> = {
  '.tex': { kind: 'latex', mediaType: 'application/x-tex', suffix: '.tex' },
  '.md': { kind: 'markdown', mediaType: 'text/markdown', suffix: '.md' },
  '.markdown': { kind: 'markdown', mediaType: 'text/markdown', suffix: '.md' },
  '.pdf': { kind: 'pdf', mediaType: 'application/pdf', suffix: '.pdf' },
};

export type LectureExternalSourceErrorCode =
  | 'lecture_external_source_invalid'
  | 'lecture_external_source_unsupported'
  | 'lecture_external_source_too_large'
  | 'lecture_external_source_total_too_large'
  | 'lecture_external_source_too_many'
  | 'lecture_external_source_encrypted'
  | 'lecture_external_source_extraction_failed'
  | 'lecture_external_source_scope_mismatch'
  | 'lecture_external_source_not_found'
  | 'lecture_external_source_expired'
  | 'lecture_external_source_corrupt';

export class LectureExternalSourceError extends Error {
  constructor(readonly code: LectureExternalSourceErrorCode) {
    super(code);
    this.name = 'LectureExternalSourceError';
  }
}

function sha256(value: Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex');
}

function safeDisplayName(path: string) {
  const cleaned = [...basename(path)]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  return cleaned.slice(0, 255) || 'Imported source';
}

function formatForPath(path: string) {
  return FORMATS[extname(path).toLocaleLowerCase()] ?? null;
}

function suffixForKind(kind: LectureExternalSourceKind) {
  return kind === 'latex' ? '.tex' : kind === 'markdown' ? '.md' : '.pdf';
}

async function readBoundedRegularFile(path: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const status = await handle.stat();
    if (!status.isFile() || status.size <= 0) {
      throw new LectureExternalSourceError('lecture_external_source_invalid');
    }
    if (status.size > LECTURE_EXTERNAL_SOURCE_MAX_BYTES) {
      throw new LectureExternalSourceError('lecture_external_source_too_large');
    }
    const bytes = Buffer.allocUnsafe(status.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== bytes.length) {
      throw new LectureExternalSourceError('lecture_external_source_invalid');
    }
    const extra = Buffer.allocUnsafe(1);
    if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) {
      throw new LectureExternalSourceError('lecture_external_source_too_large');
    }
    return bytes;
  } catch (error) {
    if (error instanceof LectureExternalSourceError) throw error;
    throw new LectureExternalSourceError('lecture_external_source_invalid');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function decodeText(bytes: Uint8Array) {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
  } catch {
    throw new LectureExternalSourceError('lecture_external_source_invalid');
  }
  if (
    [...text].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    })
  ) {
    throw new LectureExternalSourceError('lecture_external_source_invalid');
  }
  const content = text.slice(0, LECTURE_EXTERNAL_SOURCE_MAX_EXTRACTED_CHARACTERS);
  if (content.trim().length === 0) {
    throw new LectureExternalSourceError('lecture_external_source_extraction_failed');
  }
  return {
    policyVersion: 1 as const,
    characterBudget: LECTURE_EXTERNAL_SOURCE_MAX_EXTRACTED_CHARACTERS,
    unitLabel: 'part' as const,
    unitCount: 1,
    content,
    contentSha256: sha256(content),
    extractedCharacters: content.length,
    truncated: content.length < text.length,
    textAvailable: content.trim().length > 0,
    reconstructionNotice: 'Exact UTF-8 source text; content may be truncated at the stated bound.',
  };
}

function pdfExtraction(extracted: ExtractedProjectChatPdf, characterBudget: number) {
  if (!extracted.textAvailable || extracted.pages.every((page) => page.text.trim().length === 0)) {
    throw new LectureExternalSourceError('lecture_external_source_extraction_failed');
  }
  const fullContent = extracted.pages
    .map((page) => `--- page ${page.pageNumber} ---\n${page.text}`)
    .join('\n\n');
  const content = fullContent.slice(0, characterBudget);
  if (content.trim().length === 0) {
    throw new LectureExternalSourceError('lecture_external_source_extraction_failed');
  }
  return {
    policyVersion: 1 as const,
    characterBudget,
    unitLabel: 'page' as const,
    unitCount: extracted.pageCount,
    content,
    contentSha256: sha256(content),
    extractedCharacters: content.length,
    truncated: extracted.truncated || content.length < fullContent.length,
    textAvailable: content.trim().length > 0,
    reconstructionNotice:
      'Selectable PDF text only; figures, scans, equations-as-images, and page layout are not reconstructed.',
  };
}

function mapPdfError(error: ProjectChatPdfExtractionError) {
  if (error.code === 'pdf_attachment_encrypted') {
    return new LectureExternalSourceError('lecture_external_source_encrypted');
  }
  if (error.code === 'pdf_attachment_page_limit') {
    return new LectureExternalSourceError('lecture_external_source_too_large');
  }
  if (error.code === 'pdf_attachment_invalid') {
    return new LectureExternalSourceError('lecture_external_source_invalid');
  }
  return new LectureExternalSourceError('lecture_external_source_extraction_failed');
}

function pathInside(root: string, target: string) {
  const delta = relative(root, target);
  return delta.length > 0 && delta !== '..' && !delta.startsWith(`..${sep}`);
}

export class LectureExternalSourceService {
  private readonly sourceSetMutationTails = new Map<string, Promise<void>>();
  private readonly sourceSetClaims = new Map<
    string,
    Readonly<{ studioId: string; selectedSourceIds: readonly string[] }>
  >();
  private readonly studioClaimSourceSets = new Map<string, string>();

  constructor(
    private readonly dependencies: {
      rootDirectory: () => string;
      chooseFiles: () => Promise<readonly string[]>;
      validateProject: (projectId: string) => Promise<void>;
      extractPdf?: (bytes: Uint8Array, maxCharacters: number) => Promise<ExtractedProjectChatPdf>;
      manifestAuthenticator: Pick<LectureExternalSourceManifestAuthenticator, 'seal' | 'verify'>;
      removeManagedDirectory?: (directory: string) => Promise<void>;
      now?: () => Date;
    },
  ) {}

  async chooseAndStage(
    input: StageLectureExternalSourcesInput,
    options: Readonly<{
      maxSources?: number;
      maxTotalExtractedCharacters?: number;
    }> = {},
  ) {
    const command = StageLectureExternalSourcesInputSchema.parse(input);
    await this.validateProject(command.projectId);
    const selectedPaths = await this.dependencies.chooseFiles();
    if (command.sourceSetId) {
      return this.withSourceSetMutation(command.projectId, command.sourceSetId, () =>
        this.stageSelected(command, selectedPaths, options),
      );
    }
    // A new set receives a fresh unguessable identity, so it cannot alias another in-flight set.
    return this.stageSelected(command, selectedPaths, options);
  }

  private async stageSelected(
    command: StageLectureExternalSourcesInput,
    selectedPaths: readonly string[],
    options: Readonly<{
      maxSources?: number;
      maxTotalExtractedCharacters?: number;
    }>,
  ) {
    const maxSources = Math.max(
      1,
      Math.min(
        LECTURE_EXTERNAL_SOURCE_MAX_SOURCES,
        options.maxSources ?? LECTURE_EXTERNAL_SOURCE_MAX_SOURCES,
      ),
    );
    const maxTotalExtractedCharacters = Math.max(
      1,
      Math.min(
        LECTURE_EXTERNAL_SOURCE_MAX_TOTAL_EXTRACTED_CHARACTERS,
        options.maxTotalExtractedCharacters ??
          LECTURE_EXTERNAL_SOURCE_MAX_TOTAL_EXTRACTED_CHARACTERS,
      ),
    );
    const sourceSetKey = command.sourceSetId
      ? this.sourceSetMutationKey(command.projectId, command.sourceSetId)
      : null;
    if (sourceSetKey) this.assertSourceSetMutable(sourceSetKey);
    if (selectedPaths.length === 0) {
      if (command.sourceSetId) {
        return this.stagedView(
          await this.loadStaged({
            projectId: command.projectId,
            sourceSetId: command.sourceSetId,
          }),
        );
      }
      const now = this.dependencies.now?.() ?? new Date();
      const set = StagedLectureExternalSourceSetSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        projectId: command.projectId,
        sources: [],
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + LECTURE_EXTERNAL_SOURCE_SET_TTL_MS).toISOString(),
      });
      const root = await this.ensureRoot();
      const directory = join(root, 'staging', command.projectId, set.id);
      await this.createBoundedDirectory(root, directory);
      try {
        await this.writeManifest(directory, set);
        return this.stagedView(set);
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        if (error instanceof LectureExternalSourceError) throw error;
        throw new LectureExternalSourceError('lecture_external_source_corrupt');
      }
    }
    if (selectedPaths.length > maxSources) {
      throw new LectureExternalSourceError('lecture_external_source_too_many');
    }
    if (new Set(selectedPaths).size !== selectedPaths.length) {
      throw new LectureExternalSourceError('lecture_external_source_invalid');
    }
    const definitions = selectedPaths.map((path) => {
      const format = formatForPath(path);
      if (!format) throw new LectureExternalSourceError('lecture_external_source_unsupported');
      return { path, format };
    });

    const existing = command.sourceSetId
      ? await this.loadStaged({ projectId: command.projectId, sourceSetId: command.sourceSetId })
      : null;
    if (existing && existing.sources.length + definitions.length > maxSources) {
      throw new LectureExternalSourceError('lecture_external_source_too_many');
    }
    const setId = existing?.id ?? randomUUID();
    const now = this.dependencies.now?.() ?? new Date();
    const prepared: Array<{ source: StagedLectureExternalSource; bytes: Uint8Array }> = [];
    let totalBytes = existing?.sources.reduce((sum, source) => sum + source.byteSize, 0) ?? 0;
    let totalExtracted =
      existing?.sources.reduce((sum, source) => sum + source.extraction.extractedCharacters, 0) ??
      0;
    for (const { path, format } of definitions) {
      const bytes = await readBoundedRegularFile(path);
      if (
        format.kind === 'pdf' &&
        Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-'
      ) {
        throw new LectureExternalSourceError('lecture_external_source_invalid');
      }
      totalBytes += bytes.length;
      if (totalBytes > LECTURE_EXTERNAL_SOURCE_MAX_TOTAL_BYTES) {
        throw new LectureExternalSourceError('lecture_external_source_total_too_large');
      }
      let extraction;
      if (format.kind === 'pdf') {
        try {
          const characterBudget = Math.max(
            1,
            Math.min(
              LECTURE_EXTERNAL_SOURCE_MAX_EXTRACTED_CHARACTERS,
              maxTotalExtractedCharacters - totalExtracted,
            ),
          );
          extraction = pdfExtraction(
            await (this.dependencies.extractPdf ?? extractProjectChatPdf)(bytes, characterBudget),
            characterBudget,
          );
        } catch (error) {
          if (error instanceof ProjectChatPdfExtractionError) throw mapPdfError(error);
          if (error instanceof LectureExternalSourceError) throw error;
          throw new LectureExternalSourceError('lecture_external_source_extraction_failed');
        }
      } else {
        extraction = decodeText(bytes);
      }
      totalExtracted += extraction.extractedCharacters;
      if (totalExtracted > maxTotalExtractedCharacters) {
        throw new LectureExternalSourceError('lecture_external_source_total_too_large');
      }
      const sourceId = randomUUID();
      prepared.push({
        bytes,
        source: StagedLectureExternalSourceSchema.parse({
          schemaVersion: 1,
          id: sourceId,
          projectId: command.projectId,
          sourceSetId: setId,
          displayName: safeDisplayName(path),
          kind: format.kind,
          mediaType: format.mediaType,
          byteSize: bytes.length,
          sourceSha256: sha256(bytes),
          managedRelativePath: `staging/${command.projectId}/${setId}/${sourceId}${format.suffix}`,
          extraction,
          importedAt: now.toISOString(),
        }),
      });
    }
    const allKeys = [...(existing?.sources ?? []), ...prepared.map(({ source }) => source)].map(
      (source) => `${source.kind}:${source.sourceSha256}`,
    );
    if (new Set(allKeys).size !== allKeys.length) {
      throw new LectureExternalSourceError('lecture_external_source_invalid');
    }
    const set = StagedLectureExternalSourceSetSchema.parse({
      schemaVersion: 1,
      id: setId,
      projectId: command.projectId,
      sources: [...(existing?.sources ?? []), ...prepared.map(({ source }) => source)],
      createdAt: existing?.createdAt ?? now.toISOString(),
      expiresAt: new Date(now.getTime() + LECTURE_EXTERNAL_SOURCE_SET_TTL_MS).toISOString(),
    });
    const root = await this.ensureRoot();
    const directory = join(root, 'staging', command.projectId, setId);
    await this.createBoundedDirectory(root, directory);
    const written: string[] = [];
    try {
      for (const { source, bytes } of prepared) {
        const path = join(root, source.managedRelativePath);
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
        written.push(path);
      }
      await this.writeManifest(directory, set);
      return this.stagedView(set);
    } catch (error) {
      if (existing) {
        await Promise.all(written.map((path) => rm(path, { force: true }).catch(() => undefined)));
      } else {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
      if (error instanceof LectureExternalSourceError) throw error;
      throw new LectureExternalSourceError('lecture_external_source_corrupt');
    }
  }

  async listStaged(input: ListStagedLectureExternalSourcesInput) {
    const command = ListStagedLectureExternalSourcesInputSchema.parse(input);
    await this.validateProject(command.projectId);
    return this.stagedView(await this.loadStaged(command));
  }

  async snapshotStaged(
    input: SnapshotStagedLectureExternalSourcesInput,
  ): Promise<readonly StagedLectureExternalSource[]> {
    const command = SnapshotStagedLectureExternalSourcesInputSchema.parse(input);
    await this.validateProject(command.projectId);
    return this.withSourceSetMutation(command.projectId, command.sourceSetId, async () => {
      const set = await this.loadStaged(command);
      const selected = command.sourceIds.map((id) =>
        set.sources.find((source) => source.id === id),
      );
      if (selected.some((source) => !source)) {
        throw new LectureExternalSourceError('lecture_external_source_not_found');
      }
      const root = await this.ensureRoot();
      for (const source of selected as StagedLectureExternalSource[]) {
        const bytes = await readBoundedRegularFile(join(root, source.managedRelativePath));
        if (
          bytes.length !== source.byteSize ||
          sha256(bytes) !== source.sourceSha256 ||
          source.extraction.policyVersion !== 1 ||
          sha256(source.extraction.content) !== source.extraction.contentSha256
        ) {
          throw new LectureExternalSourceError('lecture_external_source_corrupt');
        }
      }
      const now = this.dependencies.now?.() ?? new Date();
      const renewed = StagedLectureExternalSourceSetSchema.parse({
        ...set,
        expiresAt: new Date(now.getTime() + LECTURE_EXTERNAL_SOURCE_SET_TTL_MS).toISOString(),
      });
      await this.writeManifest(join(root, 'staging', set.projectId, set.id), renewed);
      return command.sourceIds.map((id) =>
        structuredClone(renewed.sources.find((source) => source.id === id)!),
      );
    });
  }

  async consumeStaged(
    input: SnapshotStagedLectureExternalSourcesInput,
  ): Promise<{ consumed: true; remainingSources: number }> {
    const command = SnapshotStagedLectureExternalSourcesInputSchema.parse(input);
    await this.validateProject(command.projectId);
    return this.withSourceSetMutation(command.projectId, command.sourceSetId, async () => {
      let set: StagedLectureExternalSourceSet;
      try {
        set = await this.loadStaged(command);
      } catch (error) {
        if (
          error instanceof LectureExternalSourceError &&
          (error.code === 'lecture_external_source_not_found' ||
            error.code === 'lecture_external_source_expired')
        ) {
          return { consumed: true as const, remainingSources: 0 };
        }
        throw error;
      }
      const selected = new Set(command.sourceIds);
      const next = StagedLectureExternalSourceSetSchema.parse({
        ...set,
        sources: set.sources.filter((source) => !selected.has(source.id)),
      });
      const root = await this.ensureRoot();
      const directory = join(root, 'staging', set.projectId, set.id);
      if (next.sources.length === 0) {
        await rm(directory, { recursive: true, force: true });
      } else {
        await this.writeManifest(directory, next);
        await Promise.all(
          set.sources
            .filter((source) => selected.has(source.id))
            .map((source) =>
              rm(join(root, source.managedRelativePath), { force: true }).catch(() => undefined),
            ),
        );
      }
      return { consumed: true as const, remainingSources: next.sources.length };
    });
  }

  async removeStaged(input: RemoveStagedLectureExternalSourceInput) {
    const command = RemoveStagedLectureExternalSourceInputSchema.parse(input);
    await this.validateProject(command.projectId);
    return this.withSourceSetMutation(command.projectId, command.sourceSetId, async () => {
      this.assertSourceSetMutable(
        this.sourceSetMutationKey(command.projectId, command.sourceSetId),
      );
      const set = await this.loadStaged(command);
      const source = set.sources.find((candidate) => candidate.id === command.sourceId);
      if (!source) throw new LectureExternalSourceError('lecture_external_source_not_found');
      const next = StagedLectureExternalSourceSetSchema.parse({
        ...set,
        sources: set.sources.filter((candidate) => candidate.id !== source.id),
      });
      const root = await this.ensureRoot();
      const directory = join(root, 'staging', set.projectId, set.id);
      await this.writeManifest(directory, next);
      await rm(join(root, source.managedRelativePath), { force: true }).catch(() => undefined);
      return this.stagedView(next);
    });
  }

  async discard(input: DiscardLectureExternalSourceSetInput): Promise<{ discarded: true }> {
    const command = DiscardLectureExternalSourceSetInputSchema.parse(input);
    await this.validateProject(command.projectId);
    return this.withSourceSetMutation(command.projectId, command.sourceSetId, async () => {
      const set = await this.loadStaged(command);
      const root = await this.ensureRoot();
      await rm(join(root, 'staging', set.projectId, set.id), { recursive: true, force: true });
      this.releaseSourceSetClaim(this.sourceSetMutationKey(command.projectId, command.sourceSetId));
      return { discarded: true };
    });
  }

  async claim(input: ClaimLectureExternalSourceSetInput) {
    const command = ClaimLectureExternalSourceSetInputSchema.parse(input);
    await this.validateProject(command.projectId);
    return this.withSourceSetMutation(command.projectId, command.sourceSetId, async () => {
      const sourceSetKey = this.sourceSetMutationKey(command.projectId, command.sourceSetId);
      const currentClaim = this.sourceSetClaims.get(sourceSetKey);
      if (currentClaim) {
        if (
          currentClaim.studioId !== command.studioId ||
          currentClaim.selectedSourceIds.length !== command.selectedSourceIds.length ||
          currentClaim.selectedSourceIds.some(
            (id, index) => id !== command.selectedSourceIds[index],
          )
        ) {
          throw new LectureExternalSourceError('lecture_external_source_invalid');
        }
        const existing = await this.loadStudio({
          projectId: command.projectId,
          studioId: command.studioId,
        });
        if (
          existing.sources.length !== command.selectedSourceIds.length ||
          existing.sources.some((source, index) => source.id !== command.selectedSourceIds[index])
        ) {
          throw new LectureExternalSourceError('lecture_external_source_corrupt');
        }
        return this.listView(existing);
      }
      const set = await this.loadStaged({
        projectId: command.projectId,
        sourceSetId: command.sourceSetId,
      });
      const selected = command.selectedSourceIds.map((id) =>
        set.sources.find((source) => source.id === id),
      );
      if (selected.some((source) => !source)) {
        throw new LectureExternalSourceError('lecture_external_source_not_found');
      }
      const root = await this.ensureRoot();
      const destination = join(root, 'studios', command.projectId, command.studioId);
      const temporary = `${destination}.claim-${randomUUID()}`;
      await this.createBoundedDirectory(root, temporary);
      try {
        const sources: LectureExternalSource[] = [];
        for (const staged of selected as StagedLectureExternalSource[]) {
          const bytes = await readBoundedRegularFile(join(root, staged.managedRelativePath));
          if (bytes.length !== staged.byteSize || sha256(bytes) !== staged.sourceSha256) {
            throw new LectureExternalSourceError('lecture_external_source_corrupt');
          }
          const managedRelativePath = `studios/${command.projectId}/${command.studioId}/${staged.id}${suffixForKind(staged.kind)}`;
          const {
            sourceSetId: _sourceSetId,
            managedRelativePath: _stagedPath,
            ...provenance
          } = staged;
          const source = LectureExternalSourceSchema.parse({
            ...provenance,
            studioId: command.studioId,
            managedRelativePath,
          });
          await writeFile(join(temporary, basename(managedRelativePath)), bytes, {
            flag: 'wx',
            mode: 0o600,
          });
          sources.push(source);
        }
        const list = LectureExternalSourceListSchema.parse({
          schemaVersion: 1,
          projectId: command.projectId,
          studioId: command.studioId,
          sources,
        });
        await this.writeManifest(temporary, list);
        await mkdir(join(root, 'studios', command.projectId), { recursive: true, mode: 0o700 });
        await rename(temporary, destination);
        this.sourceSetClaims.set(sourceSetKey, {
          studioId: command.studioId,
          selectedSourceIds: [...command.selectedSourceIds],
        });
        this.studioClaimSourceSets.set(
          this.studioClaimKey(command.projectId, command.studioId),
          sourceSetKey,
        );
        // Keep the staged set until LectureStudioStorage.create succeeds. The orchestrator discards
        // it only after the Studio row commits; on preflight/create failure it purges this claimed
        // copy and can retry the same immutable staged set without asking the user to reselect files.
        return this.listView(list);
      } catch (error) {
        await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
        if (error instanceof LectureExternalSourceError) throw error;
        throw new LectureExternalSourceError('lecture_external_source_corrupt');
      }
    });
  }

  async list(input: LectureExternalSourceScopeInput) {
    const scope = LectureExternalSourceScopeInputSchema.parse(input);
    await this.validateProject(scope.projectId);
    return this.listView(await this.loadStudio(scope));
  }

  async remove(input: RemoveLectureExternalSourceInput) {
    const command = RemoveLectureExternalSourceInputSchema.parse(input);
    const scope = { projectId: command.projectId, studioId: command.studioId };
    await this.validateProject(scope.projectId);
    const current = await this.loadStudio(scope);
    const source = current.sources.find((candidate) => candidate.id === command.sourceId);
    if (!source) throw new LectureExternalSourceError('lecture_external_source_not_found');
    const next = LectureExternalSourceListSchema.parse({
      ...current,
      sources: current.sources.filter((candidate) => candidate.id !== source.id),
    });
    const root = await this.ensureRoot();
    const directory = join(root, 'studios', command.projectId, command.studioId);
    await this.writeManifest(directory, next);
    await rm(join(root, source.managedRelativePath), { force: true }).catch(() => undefined);
    return this.listView(next);
  }

  async snapshots(
    input: SnapshotLectureExternalSourcesInput,
  ): Promise<readonly LectureExternalSourceSnapshot[]> {
    const command = SnapshotLectureExternalSourcesInputSchema.parse(input);
    await this.validateProject(command.projectId);
    const list = await this.loadStudio(command);
    const selected = command.sourceIds.map((id) => list.sources.find((source) => source.id === id));
    if (selected.some((source) => !source)) {
      throw new LectureExternalSourceError('lecture_external_source_not_found');
    }
    const root = await this.ensureRoot();
    const snapshots: LectureExternalSourceSnapshot[] = [];
    for (const [index, source] of (selected as LectureExternalSource[]).entries()) {
      const bytes = await readBoundedRegularFile(join(root, source.managedRelativePath));
      if (bytes.length !== source.byteSize || sha256(bytes) !== source.sourceSha256) {
        throw new LectureExternalSourceError('lecture_external_source_corrupt');
      }
      // The authenticated manifest is the frozen extraction receipt. Never re-run a later PDF.js,
      // UTF-8 normalization, or notice-copy implementation against an old Studio: that would turn
      // a harmless app upgrade into false corruption. Policy v1 is deliberately accepted here;
      // future policy versions must add an explicit dispatcher before their manifests can parse.
      if (
        source.extraction.policyVersion !== 1 ||
        sha256(source.extraction.content) !== source.extraction.contentSha256
      ) {
        throw new LectureExternalSourceError('lecture_external_source_corrupt');
      }
      const { managedRelativePath: _managedRelativePath, ...provenance } = source;
      snapshots.push(
        LectureExternalSourceSnapshotSchema.parse({ sourceLabel: `F${index + 1}`, ...provenance }),
      );
    }
    return snapshots;
  }

  async purgeStudio(input: LectureExternalSourceScopeInput): Promise<{ purged: true }> {
    const command = LectureExternalSourceScopeInputSchema.parse(input);
    const studioKey = this.studioClaimKey(command.projectId, command.studioId);
    const sourceSetKey = this.studioClaimSourceSets.get(studioKey);
    const purge = async () => {
      const root = await this.ensureRoot();
      // This Main-only cleanup remains valid after its owning project or Studio row has already
      // been permanently removed. Identity-derived UUID paths keep the deletion inside our root.
      await this.removeManagedDirectory(join(root, 'studios', command.projectId, command.studioId));
      if (sourceSetKey && this.studioClaimSourceSets.get(studioKey) === sourceSetKey) {
        this.releaseSourceSetClaim(sourceSetKey);
      }
      return { purged: true } as const;
    };
    return sourceSetKey ? this.withSourceSetMutationKey(sourceSetKey, purge) : purge();
  }

  async rollbackClaim(
    input: LectureExternalSourceScopeInput,
  ): Promise<{ rolledBack: true; cleanupPending: boolean }> {
    const command = LectureExternalSourceScopeInputSchema.parse(input);
    const studioKey = this.studioClaimKey(command.projectId, command.studioId);
    const sourceSetKey = this.studioClaimSourceSets.get(studioKey);
    const rollback = async () => {
      let cleanupPending = false;
      try {
        const root = await this.ensureRoot();
        await this.removeManagedDirectory(
          join(root, 'studios', command.projectId, command.studioId),
        );
      } catch {
        // The source-set lease is process-local and must not strand a retry when cleanup is
        // temporarily unavailable. The identity-scoped orphan remains inside the Main-owned root
        // and startup reconciliation removes it after confirming that no Studio row owns it.
        cleanupPending = true;
      } finally {
        if (sourceSetKey && this.studioClaimSourceSets.get(studioKey) === sourceSetKey) {
          this.releaseSourceSetClaim(sourceSetKey);
        }
      }
      return { rolledBack: true as const, cleanupPending };
    };
    return sourceSetKey ? this.withSourceSetMutationKey(sourceSetKey, rollback) : rollback();
  }

  async cleanupExpired(): Promise<{ removedSourceSets: number }> {
    const root = await this.ensureRoot();
    const stagingRoot = join(root, 'staging');
    const now = (this.dependencies.now?.() ?? new Date()).getTime();
    let removedSourceSets = 0;
    const projectEntries = await readdir(stagingRoot, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    // Both loops are bounded. Anything beyond the supported active project/source-set envelope is
    // ignored rather than allowing arbitrary disk contents to turn startup cleanup into a scan.
    for (const projectEntry of projectEntries.slice(0, 200)) {
      if (!projectEntry.isDirectory() || !/^[a-f0-9-]{36}$/u.test(projectEntry.name)) continue;
      const projectDirectory = join(stagingRoot, projectEntry.name);
      const setEntries = await readdir(projectDirectory, { withFileTypes: true }).catch(() => []);
      for (const setEntry of setEntries.slice(0, 100)) {
        if (!setEntry.isDirectory() || !/^[a-f0-9-]{36}$/u.test(setEntry.name)) continue;
        const setDirectory = join(projectDirectory, setEntry.name);
        try {
          const set = StagedLectureExternalSourceSetSchema.parse(
            JSON.parse(await this.readManifest(setDirectory)),
          );
          if (
            set.projectId !== projectEntry.name ||
            set.id !== setEntry.name ||
            now < Date.parse(set.expiresAt)
          ) {
            continue;
          }
          await rm(setDirectory, { recursive: true, force: true });
          removedSourceSets += 1;
        } catch {
          // Malformed or unreadable entries are not deleted automatically; an explicit managed
          // repair/purge path must decide whether unrelated local data can be removed.
        }
      }
    }
    return { removedSourceSets };
  }

  async cleanupOrphanedStudios(
    ownedScopes: readonly LectureExternalSourceScopeInput[],
  ): Promise<{ removedStudioDirectories: number; removedClaimDirectories: number }> {
    if (ownedScopes.length > MAX_OWNED_STUDIO_SOURCE_DIRECTORIES) {
      throw new LectureExternalSourceError('lecture_external_source_corrupt');
    }
    const parsedScopes = ownedScopes.map((scope) =>
      LectureExternalSourceScopeInputSchema.parse(scope),
    );
    const owned = new Set(parsedScopes.map((scope) => `${scope.projectId}:${scope.studioId}`));
    const root = await this.ensureRoot();
    const studiosRoot = join(root, 'studios');
    const projectEntries = await readdir(studiosRoot, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    let removedStudioDirectories = 0;
    let removedClaimDirectories = 0;
    let inspected = 0;
    for (const projectEntry of projectEntries.slice(0, 200)) {
      if (!projectEntry.isDirectory() || !/^[a-f0-9-]{36}$/u.test(projectEntry.name)) continue;
      const projectDirectory = join(studiosRoot, projectEntry.name);
      const studioEntries = await readdir(projectDirectory, { withFileTypes: true }).catch(
        () => [],
      );
      for (const studioEntry of studioEntries) {
        if (inspected >= MAX_OWNED_STUDIO_SOURCE_DIRECTORIES * 2) break;
        inspected += 1;
        if (!studioEntry.isDirectory()) continue;
        const claimMatch = /^([a-f0-9-]{36})\.claim-([a-f0-9-]{36})$/u.exec(studioEntry.name);
        if (claimMatch) {
          // Claim directories are never authoritative. A live claim is impossible during startup
          // reconciliation, so an identity-shaped leftover is safe to remove from the Main-owned root.
          await rm(join(projectDirectory, studioEntry.name), { recursive: true, force: true });
          removedClaimDirectories += 1;
          continue;
        }
        if (!/^[a-f0-9-]{36}$/u.test(studioEntry.name)) continue;
        const identity = `${projectEntry.name}:${studioEntry.name}`;
        if (owned.has(identity)) continue;
        const studioDirectory = join(projectDirectory, studioEntry.name);
        try {
          const list = LectureExternalSourceListSchema.parse(
            JSON.parse(await this.readManifest(studioDirectory)),
          );
          if (list.projectId !== projectEntry.name || list.studioId !== studioEntry.name) continue;
          await rm(studioDirectory, { recursive: true, force: true });
          removedStudioDirectories += 1;
        } catch {
          // Do not guess about malformed directories even inside the managed root. A repair flow
          // can surface them without risking unrelated local data.
        }
      }
    }
    return { removedStudioDirectories, removedClaimDirectories };
  }

  private sourceSetMutationKey(projectId: string, sourceSetId: string) {
    return `${projectId}:${sourceSetId}`;
  }

  private studioClaimKey(projectId: string, studioId: string) {
    return `${projectId}:${studioId}`;
  }

  private assertSourceSetMutable(sourceSetKey: string) {
    if (this.sourceSetClaims.has(sourceSetKey)) {
      throw new LectureExternalSourceError('lecture_external_source_invalid');
    }
  }

  private releaseSourceSetClaim(sourceSetKey: string) {
    const claim = this.sourceSetClaims.get(sourceSetKey);
    if (!claim) return;
    this.sourceSetClaims.delete(sourceSetKey);
    const separator = sourceSetKey.indexOf(':');
    const projectId = sourceSetKey.slice(0, separator);
    const studioKey = this.studioClaimKey(projectId, claim.studioId);
    if (this.studioClaimSourceSets.get(studioKey) === sourceSetKey) {
      this.studioClaimSourceSets.delete(studioKey);
    }
  }

  private withSourceSetMutation<T>(
    projectId: string,
    sourceSetId: string,
    mutation: () => Promise<T>,
  ) {
    return this.withSourceSetMutationKey(
      this.sourceSetMutationKey(projectId, sourceSetId),
      mutation,
    );
  }

  private withSourceSetMutationKey<T>(key: string, mutation: () => Promise<T>): Promise<T> {
    const predecessor = this.sourceSetMutationTails.get(key) ?? Promise.resolve();
    // Both fulfillment and rejection advance the FIFO: one failed mutation must never poison the
    // queue or allow a later writer to overtake it.
    const result = predecessor.then(mutation, mutation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.sourceSetMutationTails.set(key, tail);
    void tail.finally(() => {
      if (this.sourceSetMutationTails.get(key) === tail) {
        this.sourceSetMutationTails.delete(key);
      }
    });
    return result;
  }

  private async validateProject(projectId: string) {
    try {
      await this.dependencies.validateProject(projectId);
    } catch {
      throw new LectureExternalSourceError('lecture_external_source_scope_mismatch');
    }
  }

  private async ensureRoot() {
    const requested = resolve(this.dependencies.rootDirectory());
    await mkdir(requested, { recursive: true, mode: 0o700 });
    await chmod(requested, 0o700);
    return realpath(requested);
  }

  private async createBoundedDirectory(root: string, directory: string) {
    const delta = relative(root, resolve(directory));
    if (!delta || delta === '..' || delta.startsWith(`..${sep}`)) {
      throw new LectureExternalSourceError('lecture_external_source_corrupt');
    }
    let current = root;
    for (const segment of delta.split(sep)) {
      const requested = join(current, segment);
      await mkdir(requested, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const canonical = await realpath(requested);
      // Main-owned import directories never accept aliases or symlinks, even if the target happens
      // to remain inside userData. This keeps every identity-derived path single-valued.
      if (!pathInside(root, canonical) || canonical !== resolve(requested)) {
        throw new LectureExternalSourceError('lecture_external_source_corrupt');
      }
      await chmod(canonical, 0o700);
      current = canonical;
    }
    return current;
  }

  private removeManagedDirectory(directory: string) {
    return this.dependencies.removeManagedDirectory
      ? this.dependencies.removeManagedDirectory(directory)
      : rm(directory, { recursive: true, force: true });
  }

  private async loadStaged(input: ListStagedLectureExternalSourcesInput) {
    const root = await this.ensureRoot();
    const directory = join(root, 'staging', input.projectId, input.sourceSetId);
    try {
      const set = StagedLectureExternalSourceSetSchema.parse(
        JSON.parse(await this.readManifest(directory)),
      );
      if (set.projectId !== input.projectId || set.id !== input.sourceSetId) {
        throw new LectureExternalSourceError('lecture_external_source_scope_mismatch');
      }
      if ((this.dependencies.now?.() ?? new Date()).getTime() >= Date.parse(set.expiresAt)) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        throw new LectureExternalSourceError('lecture_external_source_expired');
      }
      return set;
    } catch (error) {
      if (error instanceof LectureExternalSourceError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new LectureExternalSourceError('lecture_external_source_not_found');
      }
      throw new LectureExternalSourceError('lecture_external_source_corrupt');
    }
  }

  private async loadStudio(input: LectureExternalSourceScopeInput) {
    const root = await this.ensureRoot();
    const directory = join(root, 'studios', input.projectId, input.studioId);
    try {
      const list = LectureExternalSourceListSchema.parse(
        JSON.parse(await this.readManifest(directory)),
      );
      if (list.projectId !== input.projectId || list.studioId !== input.studioId) {
        throw new LectureExternalSourceError('lecture_external_source_scope_mismatch');
      }
      return list;
    } catch (error) {
      if (error instanceof LectureExternalSourceError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return LectureExternalSourceListSchema.parse({ schemaVersion: 1, ...input, sources: [] });
      }
      throw new LectureExternalSourceError('lecture_external_source_corrupt');
    }
  }

  private extractionView(extraction: LectureExternalSource['extraction']) {
    const { content: _content, contentSha256: _contentSha256, ...view } = extraction;
    return view;
  }

  private stagedView(set: StagedLectureExternalSourceSet) {
    return StagedLectureExternalSourceSetViewSchema.parse({
      ...set,
      sources: set.sources.map(({ managedRelativePath: _path, extraction, ...source }) => ({
        ...source,
        extraction: this.extractionView(extraction),
      })),
    });
  }

  private listView(list: LectureExternalSourceList) {
    return LectureExternalSourceListViewSchema.parse({
      ...list,
      sources: list.sources.map(({ managedRelativePath: _path, extraction, ...source }) => ({
        ...source,
        extraction: this.extractionView(extraction),
      })),
    });
  }

  private async readManifest(directory: string) {
    const raw = await readFile(join(directory, MANIFEST_FILE), 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_MANIFEST_ENVELOPE_BYTES) {
      throw new LectureExternalSourceError('lecture_external_source_corrupt');
    }
    try {
      const envelope = AuthenticatedManifestEnvelopeSchema.parse(JSON.parse(raw));
      if (
        !(await this.dependencies.manifestAuthenticator.verify(
          envelope.payloadJson,
          envelope.authentication,
        ))
      ) {
        throw new LectureExternalSourceError('lecture_external_source_corrupt');
      }
      return envelope.payloadJson;
    } catch (error) {
      if (error instanceof LectureExternalSourceError) throw error;
      throw new LectureExternalSourceError('lecture_external_source_corrupt');
    }
  }

  private async writeManifest(directory: string, manifest: unknown) {
    const temporary = join(directory, `.sources-${randomUUID()}.tmp`);
    try {
      const payloadJson = JSON.stringify(manifest);
      const envelope = AuthenticatedManifestEnvelopeSchema.parse({
        schemaVersion: 1,
        payloadJson,
        authentication: await this.dependencies.manifestAuthenticator.seal(payloadJson),
      });
      await writeFile(temporary, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 });
      await rename(temporary, join(directory, MANIFEST_FILE));
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
