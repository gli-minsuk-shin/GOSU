import { parseModelImportJson } from './model-lab-import';
import type { ModelLabModelSelection } from './model-lab-runtime-adapter';
import type { ModelSpec } from './model-lab-schema';

export const MODEL_BUILDER_ENDPOINT = '/api/model-builder';
export const MODEL_LAB_MAX_TEXT_SOURCE_BYTES = 1_000_000;
export const MODEL_LAB_MAX_BINARY_SOURCE_BYTES = 8_000_000;

export type ModelBuildArtifactKind = 'python' | 'text' | 'image' | 'pdf' | 'docx';

export type ModelBuildArtifact = Readonly<{
  name: string;
  mediaType: string;
  kind: ModelBuildArtifactKind;
  encoding: 'utf8' | 'base64';
  content: string;
}>;

export type ModelBuildResult = Readonly<{
  model: ModelSpec;
  trace: readonly string[];
}>;

export type PreparedModelArtifact =
  Readonly<{ ok: true; artifact: ModelBuildArtifact }> | Readonly<{ ok: false; reason: string }>;

type FetchLike = typeof fetch;

function extension(name: string) {
  const match = /\.([^.]+)$/.exec(name.toLowerCase());
  return match?.[1] ?? '';
}

export function modelBuildArtifactKind(file: Pick<File, 'name' | 'type'>) {
  const suffix = extension(file.name);
  if (suffix === 'py') return 'python' as const;
  if (suffix === 'pdf' || file.type === 'application/pdf') return 'pdf' as const;
  if (
    suffix === 'docx' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx' as const;
  }
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(suffix)) {
    return 'image' as const;
  }
  if (
    ['txt', 'md', 'tex', 'rst', 'csv', 'yaml', 'yml'].includes(suffix) ||
    file.type.startsWith('text/')
  ) {
    return 'text' as const;
  }
  return null;
}

function base64From(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function prepareModelBuildArtifact(file: File): Promise<PreparedModelArtifact> {
  const kind = modelBuildArtifactKind(file);
  if (kind === null) {
    return {
      ok: false,
      reason: 'Use ModelIR JSON, Python, PNG/JPEG/WebP, PDF, DOCX, Markdown, or text files.',
    };
  }
  const textSource = kind === 'python' || kind === 'text';
  const limit = textSource ? MODEL_LAB_MAX_TEXT_SOURCE_BYTES : MODEL_LAB_MAX_BINARY_SOURCE_BYTES;
  if (file.size > limit) {
    return {
      ok: false,
      reason: `${textSource ? 'Text/code' : 'Image/PDF/DOCX'} source exceeds the ${limit / 1_000_000} MB limit.`,
    };
  }
  if (textSource) {
    return {
      ok: true,
      artifact: {
        name: file.name,
        mediaType: file.type || (kind === 'python' ? 'text/x-python' : 'text/plain'),
        kind,
        encoding: 'utf8',
        content: await file.text(),
      },
    };
  }
  return {
    ok: true,
    artifact: {
      name: file.name,
      mediaType:
        file.type ||
        (kind === 'pdf'
          ? 'application/pdf'
          : kind === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : extension(file.name) === 'png'
              ? 'image/png'
              : 'image/jpeg'),
      kind,
      encoding: 'base64',
      content: base64From(new Uint8Array(await file.arrayBuffer())),
    },
  };
}

/**
 * Model Copilot attachments share the bounded artifact transport used by the builder, but JSON is
 * treated as conversation evidence instead of a ModelIR import. Keeping this entry point separate
 * prevents the chat composer from ever creating or mutating a model session.
 */
export async function prepareModelCopilotAttachment(file: File): Promise<PreparedModelArtifact> {
  if (extension(file.name) === 'json' || file.type === 'application/json') {
    if (file.size > MODEL_LAB_MAX_TEXT_SOURCE_BYTES) {
      return {
        ok: false,
        reason: `Text/code source exceeds the ${MODEL_LAB_MAX_TEXT_SOURCE_BYTES / 1_000_000} MB limit.`,
      };
    }
    return {
      ok: true,
      artifact: {
        name: file.name,
        mediaType: file.type || 'application/json',
        kind: 'text',
        encoding: 'utf8',
        content: await file.text(),
      },
    };
  }
  return prepareModelBuildArtifact(file);
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function createModelBuilder(fetchImpl: FetchLike = fetch) {
  return {
    async build(
      artifacts: readonly ModelBuildArtifact[],
      selection?: ModelLabModelSelection,
    ): Promise<ModelBuildResult> {
      const response = await fetchImpl(MODEL_BUILDER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifacts, selection }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== 'object') {
        const detail =
          payload && typeof payload === 'object' && 'detail' in payload
            ? String(payload.detail)
            : 'model_builder_unavailable';
        throw new Error(detail);
      }
      const candidate = payload as { model?: unknown; trace?: unknown };
      const parsed = parseModelImportJson(JSON.stringify(candidate.model));
      if (!parsed.ok) throw new Error(`Generated ModelIR was invalid: ${parsed.reason}`);
      if (!stringArray(candidate.trace)) throw new Error('Model builder trace was invalid.');
      return { model: parsed.model, trace: candidate.trace };
    },
  };
}

export const codexModelBuilder = createModelBuilder();
