import { createHash, randomUUID } from 'node:crypto';
import { applicationLanguageSnapshot } from '../desktop/src/main/application-language-service';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { modelLabBackendDirectory } from './model-lab-backend-context';
import { join } from 'node:path';
import type { ModelBuildArtifact } from './src/model-lab-builder';
import { parseModelImportJson } from './src/model-lab-import';
import type { ModelSpec } from './src/model-lab-schema';

export const MODEL_BUILDER_PIPELINE_VERSION =
  'model-ir-canonical-v1-semantic-harness-v9-tensor-narrative-20260914';
export const MODEL_BUILDER_CACHE_ENTRY_VERSION = 1 as const;
export const MODEL_BUILDER_CACHE_MAX_BYTES = 2_000_000;

export type ModelBuilderCacheOrigin = Readonly<{
  providerId: string;
  providerLabel: string;
  modelId: string;
  reasoning: string;
  repairCount: number;
  generatedAt: string;
}>;

export type ModelBuilderCacheHit = Readonly<{
  sourceDigest: string;
  modelIrDigest: string;
  model: ModelSpec;
  origin: ModelBuilderCacheOrigin;
}>;

type ModelBuilderCacheEntry = Readonly<{
  entryVersion: typeof MODEL_BUILDER_CACHE_ENTRY_VERSION;
  pipelineVersion: string;
  sourceDigest: string;
  modelIrDigest: string;
  artifacts: readonly Readonly<{
    name: string;
    kind: ModelBuildArtifact['kind'];
    byteLength: number;
    sha256: string;
  }>[];
  model: ModelSpec;
  origin: ModelBuilderCacheOrigin;
}>;

function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function artifactBytes(artifact: ModelBuildArtifact) {
  return artifact.encoding === 'base64'
    ? Buffer.from(artifact.content, 'base64')
    : Buffer.from(artifact.content, 'utf8');
}

export function modelBuilderArtifactManifest(artifacts: readonly ModelBuildArtifact[]) {
  return artifacts
    .map((artifact) => {
      const bytes = artifactBytes(artifact);
      return {
        name: artifact.name.normalize('NFC'),
        kind: artifact.kind,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      } as const;
    })
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.kind.localeCompare(right.kind) ||
        left.sha256.localeCompare(right.sha256),
    );
}

export function modelBuilderSourceDigest(artifacts: readonly ModelBuildArtifact[]) {
  return sha256(
    JSON.stringify({
      pipelineVersion: MODEL_BUILDER_PIPELINE_VERSION,
      ...(applicationLanguageSnapshot().configured
        ? { applicationLanguage: applicationLanguageSnapshot().language }
        : {}),
      artifacts: modelBuilderArtifactManifest(artifacts),
    }),
  );
}

function cacheRoot(root?: string) {
  return (
    root ??
    modelLabBackendDirectory('model-builder-cache', process.env.GOSU_MODEL_LAB_IMPORT_CACHE_ROOT)
  );
}

function cachePath(sourceDigest: string, root?: string) {
  return join(cacheRoot(root), MODEL_BUILDER_PIPELINE_VERSION, `${sourceDigest}.json`);
}

export async function readModelBuilderCache(
  artifacts: readonly ModelBuildArtifact[],
  root?: string,
): Promise<ModelBuilderCacheHit | null> {
  const sourceDigest = modelBuilderSourceDigest(artifacts);
  try {
    const text = await readFile(cachePath(sourceDigest, root), 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MODEL_BUILDER_CACHE_MAX_BYTES) return null;
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Partial<ModelBuilderCacheEntry>;
    if (
      entry.entryVersion !== MODEL_BUILDER_CACHE_ENTRY_VERSION ||
      entry.pipelineVersion !== MODEL_BUILDER_PIPELINE_VERSION ||
      entry.sourceDigest !== sourceDigest ||
      !entry.model ||
      !entry.origin
    ) {
      return null;
    }
    const storedModelIrDigest = sha256(JSON.stringify(entry.model));
    if (entry.modelIrDigest !== storedModelIrDigest) return null;
    const parsed = parseModelImportJson(JSON.stringify(entry.model), {
      enforceSourceOutputContracts: true,
      allowSubgraphs: false,
      sourceArtifactNames: artifacts.map((artifact) => artifact.name),
    });
    if (!parsed.ok) return null;
    const modelIrDigest = sha256(JSON.stringify(parsed.model));
    return { sourceDigest, modelIrDigest, model: parsed.model, origin: entry.origin };
  } catch {
    return null;
  }
}

async function writeModelBuilderCacheOnce(
  artifacts: readonly ModelBuildArtifact[],
  model: ModelSpec,
  origin: ModelBuilderCacheOrigin,
  root?: string,
): Promise<ModelBuilderCacheHit> {
  const existing = await readModelBuilderCache(artifacts, root);
  if (existing) return existing;
  const parsed = parseModelImportJson(JSON.stringify(model), {
    enforceSourceOutputContracts: true,
    allowSubgraphs: false,
    sourceArtifactNames: artifacts.map((artifact) => artifact.name),
  });
  if (!parsed.ok) throw new Error(`model_builder_cache_invalid_model: ${parsed.reason}`);
  const sourceDigest = modelBuilderSourceDigest(artifacts);
  const modelIrDigest = sha256(JSON.stringify(parsed.model));
  const directory = join(cacheRoot(root), MODEL_BUILDER_PIPELINE_VERSION);
  const target = cachePath(sourceDigest, root);
  const temporary = join(directory, `${sourceDigest}.${process.pid}.${randomUUID()}.tmp`);
  const entry: ModelBuilderCacheEntry = {
    entryVersion: MODEL_BUILDER_CACHE_ENTRY_VERSION,
    pipelineVersion: MODEL_BUILDER_PIPELINE_VERSION,
    sourceDigest,
    modelIrDigest,
    artifacts: modelBuilderArtifactManifest(artifacts),
    model: parsed.model,
    origin,
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, JSON.stringify(entry), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    try {
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const winner = await readModelBuilderCache(artifacts, root);
      if (winner) return winner;
      const quarantine = `${target}.invalid.${process.pid}.${randomUUID()}`;
      try {
        await rename(target, quarantine);
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code !== 'ENOENT') throw renameError;
      }
      try {
        await link(temporary, target);
      } catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code !== 'EEXIST') throw retryError;
        const retryWinner = await readModelBuilderCache(artifacts, root);
        if (retryWinner) return retryWinner;
        throw retryError;
      } finally {
        await rm(quarantine, { force: true });
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return { sourceDigest, modelIrDigest, model: parsed.model, origin };
}

const inFlightCacheWrites = new Map<string, Promise<ModelBuilderCacheHit>>();

export function writeModelBuilderCache(
  artifacts: readonly ModelBuildArtifact[],
  model: ModelSpec,
  origin: ModelBuilderCacheOrigin,
  root?: string,
): Promise<ModelBuilderCacheHit> {
  const key = cachePath(modelBuilderSourceDigest(artifacts), root);
  const existing = inFlightCacheWrites.get(key);
  if (existing) return existing;
  const pending = writeModelBuilderCacheOnce(artifacts, model, origin, root).finally(() => {
    if (inFlightCacheWrites.get(key) === pending) inFlightCacheWrites.delete(key);
  });
  inFlightCacheWrites.set(key, pending);
  return pending;
}
