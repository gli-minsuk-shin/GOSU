import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { modelLabBackendDirectory } from './model-lab-backend-context';
import { basename, join } from 'node:path';
import type { ModelBuildProgress } from './src/model-lab-builder';

export const MODEL_BUILDER_DIAGNOSTIC_MAX_EVENTS = 50;
export const MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATES = 3;
export const MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATE_BYTES = 1_048_576;
export const MODEL_BUILDER_DIAGNOSTIC_MAX_DETAIL_CHARS = 2_000;

/** Untrusted saved candidate; callers must run the complete current import audit. */
export async function readLatestModelBuilderCandidate(
  sourceDigest: string,
  root = modelLabBackendDirectory('import-runs'),
): Promise<Readonly<{ candidate: string; runId: string }> | null> {
  if (!/^[a-f\d]{64}$/i.test(sourceDigest)) return null;
  try {
    const files = (await readdir(root, { withFileTypes: true })).filter(
      (file) =>
        file.isFile() && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}\.json$/iu.test(file.name),
    );
    const recent = await Promise.all(
      files.map(async (file) => {
        try {
          const info = await lstat(join(root, file.name));
          return info.isFile() && info.size <= 3_500_000
            ? { name: file.name, updated: info.mtimeMs }
            : null;
        } catch {
          return null;
        }
      }),
    );
    const ordered = recent
      .filter((file) => file !== null)
      .sort((left, right) => right.updated - left.updated)
      .slice(0, 100);
    for (const file of ordered) {
      try {
        const text = await readFile(join(root, file.name), 'utf8');
        if (Buffer.byteLength(text, 'utf8') > 3_500_000) continue;
        const entry: unknown = JSON.parse(text);
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const saved = entry as Partial<JournalEntry>;
        const runId = file.name.slice(0, -5);
        if (
          saved.version !== 1 ||
          saved.id !== runId ||
          saved.status !== 'failed' ||
          saved.metadata?.sourceDigest !== sourceDigest.toLowerCase() ||
          !Array.isArray(saved.candidates)
        )
          continue;
        for (const candidate of saved.candidates.slice(-3).reverse()) {
          if (
            candidate &&
            candidate.truncated === false &&
            typeof candidate.text === 'string' &&
            candidate.text.trim() &&
            Buffer.byteLength(candidate.text, 'utf8') <=
              MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATE_BYTES
          )
            return { candidate: candidate.text, runId };
        }
      } catch {
        // Invalid/interrupted receipts cannot prevent trying an older exact-source run.
      }
    }
  } catch {
    // An absent diagnostics directory is the normal first-import case.
  }
  return null;
}

export type ModelBuilderDiagnosticMetadata = Readonly<{
  sourceDigest: string;
  artifacts: readonly Readonly<{
    name: string;
    kind: string;
    byteLength: number;
    sha256: string;
  }>[];
  providerId?: string;
  modelId?: string;
  reasoning?: string;
}>;

export type ModelBuilderDiagnosticRun = Readonly<{
  id: string;
  event: (progress: ModelBuildProgress) => Promise<void>;
  candidate: (attemptNumber: number, text: string) => Promise<void>;
  finish: (result: Readonly<{ status: 'complete' | 'failed'; error?: string }>) => Promise<void>;
}>;

type JournalEntry = {
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'complete' | 'failed';
  metadata: ModelBuilderDiagnosticMetadata;
  artifactsOmitted: number;
  events: {
    time: string;
    phase: string;
    message: string;
    truncated: boolean;
  }[];
  eventsOmitted: number;
  candidates: {
    attemptNumber: number;
    time: string;
    text: string;
    originalBytes: number;
    truncated: boolean;
  }[];
  candidatesOmitted: number;
  error?: string;
  errorTruncated?: boolean;
};

// Persist only the caller's generated candidate and whitelisted receipt fields. Never
// spread a request, artifact, progress object, Error, environment, or provider output.
function redact(value: string) {
  return value
    .replace(/\b(?:sk|rk)-[a-zA-Z0-9_-]{16,}\b/g, '[redacted-key]')
    .replace(/\bBearer\s+[a-zA-Z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization)["']?\s*[:=]\s*["']?)[^\s,"'\\}]+/gi,
      '$1[redacted]',
    );
}

function detail(value: string, limit = MODEL_BUILDER_DIAGNOSTIC_MAX_DETAIL_CHARS) {
  const clean = redact(value);
  return { text: clean.slice(0, limit), truncated: clean.length > limit };
}

function digest(value: string) {
  if (!/^[a-f\d]{64}$/i.test(value)) {
    throw new Error('model_builder_diagnostic_invalid_digest');
  }
  return value.toLowerCase();
}

function candidateText(value: string) {
  const clean = redact(value);
  const bytes = Buffer.from(clean, 'utf8');
  const originalBytes = Buffer.byteLength(value, 'utf8');
  if (bytes.byteLength <= MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATE_BYTES) {
    return { text: clean, originalBytes, truncated: false };
  }
  // TextDecoder's streaming mode drops an incomplete final UTF-8 character.
  const text = new TextDecoder('utf-8').decode(
    bytes.subarray(0, MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATE_BYTES),
    { stream: true },
  );
  return { text, originalBytes, truncated: true };
}

/** Local-only receipt; id can be exposed to UI, but the filesystem path is not returned. */
export async function createModelBuilderDiagnosticRun(
  metadata: ModelBuilderDiagnosticMetadata,
  root = modelLabBackendDirectory('import-runs'),
): Promise<ModelBuilderDiagnosticRun> {
  const id = randomUUID();
  const time = new Date().toISOString();
  let entry: JournalEntry = {
    version: 1,
    id,
    createdAt: time,
    updatedAt: time,
    status: 'running',
    metadata: {
      sourceDigest: digest(metadata.sourceDigest),
      artifacts: metadata.artifacts.slice(0, 16).map((artifact) => {
        if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0) {
          throw new Error('model_builder_diagnostic_invalid_artifact_size');
        }
        return {
          name: detail(basename(artifact.name.replace(/\\/g, '/')), 256).text,
          kind: detail(artifact.kind, 64).text,
          byteLength: artifact.byteLength,
          sha256: digest(artifact.sha256),
        };
      }),
      ...(metadata.providerId ? { providerId: detail(metadata.providerId, 128).text } : {}),
      ...(metadata.modelId ? { modelId: detail(metadata.modelId, 128).text } : {}),
      ...(metadata.reasoning ? { reasoning: detail(metadata.reasoning, 64).text } : {}),
    },
    artifactsOmitted: Math.max(0, metadata.artifacts.length - 16),
    events: [],
    eventsOmitted: 0,
    candidates: [],
    candidatesOmitted: 0,
  };
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const target = join(root, `${id}.json`);

  async function persist(next: JournalEntry) {
    const temporary = join(root, `${id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(next), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  await persist(entry);
  let pending: Promise<void> = Promise.resolve();
  function enqueue(update: (next: JournalEntry) => void): Promise<void> {
    const operation = pending.then(async () => {
      if (entry.status !== 'running') return;
      const next = structuredClone(entry);
      next.updatedAt = new Date().toISOString();
      update(next);
      await persist(next);
      entry = next;
    });
    // A transient disk error must not poison every later receipt write.
    pending = operation.catch(() => undefined);
    return operation;
  }

  return {
    id,
    event(progress) {
      return enqueue((next) => {
        const message = detail(progress.message);
        next.events.push({
          time: next.updatedAt,
          phase: detail(progress.phase, 64).text,
          message: message.text,
          truncated: message.truncated,
        });
        if (progress.providerId)
          next.metadata = { ...next.metadata, providerId: detail(progress.providerId, 128).text };
        if (progress.modelId)
          next.metadata = { ...next.metadata, modelId: detail(progress.modelId, 128).text };
        if (progress.reasoning)
          next.metadata = { ...next.metadata, reasoning: detail(progress.reasoning, 64).text };
        const excess = Math.max(0, next.events.length - MODEL_BUILDER_DIAGNOSTIC_MAX_EVENTS);
        next.events.splice(0, excess);
        next.eventsOmitted += excess;
      });
    },
    candidate(attemptNumber, text) {
      if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
        return Promise.reject(new Error('model_builder_diagnostic_invalid_attempt'));
      }
      return enqueue((next) => {
        next.candidates.push({ attemptNumber, time: next.updatedAt, ...candidateText(text) });
        const excess = Math.max(
          0,
          next.candidates.length - MODEL_BUILDER_DIAGNOSTIC_MAX_CANDIDATES,
        );
        next.candidates.splice(0, excess);
        next.candidatesOmitted += excess;
      });
    },
    finish(result) {
      return enqueue((next) => {
        next.status = result.status;
        if (result.error) {
          const error = detail(result.error);
          next.error = error.text;
          next.errorTruncated = error.truncated;
        }
      });
    },
  };
}
