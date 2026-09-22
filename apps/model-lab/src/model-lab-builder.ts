import { parseModelImportJson } from './model-lab-import';
import { modelLabFetch } from './model-lab-environment';
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

export type ModelBuildProgressPhase =
  | 'cache-checking'
  | 'cache-hit'
  | 'cache-miss'
  | 'request-validated'
  | 'selection-resolved'
  | 'sources-preparing'
  | 'sources-prepared'
  | 'llm-running'
  | 'model-ir-validating'
  | 'model-ir-repairing'
  | 'model-ir-validated'
  | 'failed';

export type ModelBuildProgress = Readonly<{
  phase: ModelBuildProgressPhase;
  message: string;
  providerId?: string;
  modelId?: string;
  modelLabel?: string;
  reasoning?: string;
}>;

export type ModelBuildOptions = Readonly<{
  signal?: AbortSignal;
  onProgress?: (progress: ModelBuildProgress) => void;
}>;

export type PreparedModelArtifact =
  Readonly<{ ok: true; artifact: ModelBuildArtifact }> | Readonly<{ ok: false; reason: string }>;

type FetchLike = typeof fetch;

function extension(name: string) {
  const match = /\.([^.]+)$/.exec(name.toLowerCase());
  return match?.[1] ?? '';
}

const RTF_IGNORED_DESTINATIONS = new Set([
  'colortbl',
  'datastore',
  'filetbl',
  'fonttbl',
  'footer',
  'footerl',
  'footerr',
  'header',
  'headerl',
  'headerr',
  'info',
  'listoverridetable',
  'listtable',
  'nonshppict',
  'object',
  'pict',
  'shppict',
  'stylesheet',
  'themedata',
  'xmlnstbl',
]);

const RTF_VISIBLE_CONTROLS: Readonly<Record<string, string>> = {
  bullet: '•',
  cell: '\t',
  emdash: '—',
  endash: '–',
  ldblquote: '“',
  line: '\n',
  lquote: '‘',
  par: '\n',
  rdblquote: '”',
  row: '\n',
  rquote: '’',
  tab: '\t',
};

const RTF_FONT_CHARSET_ENCODINGS: Readonly<Record<number, string>> = {
  128: 'shift_jis',
  129: 'euc-kr',
  134: 'gbk',
  136: 'big5',
  161: 'windows-1253',
  162: 'windows-1254',
  177: 'windows-1255',
  178: 'windows-1256',
  186: 'windows-1257',
  204: 'windows-1251',
  222: 'windows-874',
  238: 'windows-1250',
};

function rtfAnsiEncoding(source: string) {
  const codePage = /\\ansicpg(\d+)/i.exec(source)?.[1];
  if (codePage === '949') return 'euc-kr';
  if (codePage === '932') return 'shift_jis';
  if (codePage === '936') return 'gbk';
  if (codePage === '950') return 'big5';
  return codePage && /^12(?:50|51|52|53|54|55|56|57|58)$/.test(codePage)
    ? `windows-${codePage}`
    : 'windows-1252';
}

function rtfFontEncodings(source: string) {
  const fallback = rtfAnsiEncoding(source);
  const encodings = new Map<number, string>();
  const fontPattern = /\\f(\d+)[^;{}]*?\\fcharset(\d+)[^;{}]*?;/gi;
  for (const match of source.matchAll(fontPattern)) {
    const fontId = Number.parseInt(match[1]!, 10);
    const charset = Number.parseInt(match[2]!, 10);
    encodings.set(fontId, RTF_FONT_CHARSET_ENCODINGS[charset] ?? fallback);
  }
  return { encodings, fallback } as const;
}

function rtfHexText(bytes: readonly number[], encoding: string) {
  try {
    return new TextDecoder(encoding).decode(Uint8Array.from(bytes));
  } catch {
    return new TextDecoder('windows-1252').decode(Uint8Array.from(bytes));
  }
}

export function extractRtfText(source: string) {
  if (!/^\s*\{\\rtf(?:\d+)?\b/i.test(source)) return '';
  const fontEncodings = rtfFontEncodings(source);
  const stack: Array<{ skip: boolean; unicodeFallbackLength: number; fontId: number }> = [
    { skip: false, unicodeFallbackLength: 1, fontId: 0 },
  ];
  const output: string[] = [];
  let index = 0;
  while (index < source.length) {
    const state = stack[stack.length - 1]!;
    const character = source[index]!;
    if (character === '{') {
      stack.push({ ...state });
      index += 1;
      continue;
    }
    if (character === '}') {
      if (stack.length > 1) stack.pop();
      index += 1;
      continue;
    }
    if (character !== '\\') {
      if (!state.skip && character !== '\r' && character !== '\n') output.push(character);
      index += 1;
      continue;
    }

    index += 1;
    const symbol = source[index];
    if (symbol === undefined) break;
    if (symbol === '\\' || symbol === '{' || symbol === '}') {
      if (!state.skip) output.push(symbol);
      index += 1;
      continue;
    }
    if (symbol === "'" && /^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
      const bytes: number[] = [];
      let cursor = index;
      while (
        source[cursor] === "'" &&
        /^[0-9a-f]{2}$/i.test(source.slice(cursor + 1, cursor + 3))
      ) {
        bytes.push(Number.parseInt(source.slice(cursor + 1, cursor + 3), 16));
        cursor += 3;
        if (source[cursor] === '\\' && source[cursor + 1] === "'") cursor += 1;
      }
      if (!state.skip) {
        output.push(
          rtfHexText(bytes, fontEncodings.encodings.get(state.fontId) ?? fontEncodings.fallback),
        );
      }
      index = cursor;
      continue;
    }
    if (symbol === '*') {
      state.skip = true;
      index += 1;
      continue;
    }
    if (!/[A-Za-z]/.test(symbol)) {
      if (!state.skip) {
        if (symbol === '~') output.push(' ');
        else if (symbol === '_') output.push('-');
        else if (symbol === '\r' || symbol === '\n') output.push('\n');
      }
      index += symbol === '\r' && source[index + 1] === '\n' ? 2 : 1;
      continue;
    }

    const wordStart = index;
    while (/[A-Za-z]/.test(source[index] ?? '')) index += 1;
    const controlWord = source.slice(wordStart, index).toLowerCase();
    let sign = 1;
    if (source[index] === '-') {
      sign = -1;
      index += 1;
    }
    const numberStart = index;
    while (/\d/.test(source[index] ?? '')) index += 1;
    const numberText = source.slice(numberStart, index);
    const parameter = numberText ? sign * Number.parseInt(numberText, 10) : null;
    if (source[index] === ' ') index += 1;

    if (RTF_IGNORED_DESTINATIONS.has(controlWord)) {
      state.skip = true;
      continue;
    }
    if (controlWord === 'uc' && parameter !== null) {
      state.unicodeFallbackLength = Math.max(0, Math.min(16, parameter));
      continue;
    }
    if (controlWord === 'f' && parameter !== null) {
      state.fontId = Math.max(0, parameter);
      continue;
    }
    if (controlWord === 'bin' && parameter !== null) {
      index = Math.min(source.length, index + Math.max(0, parameter));
      continue;
    }
    if (controlWord === 'u' && parameter !== null) {
      if (!state.skip) {
        const codePoint = parameter < 0 ? parameter + 65_536 : parameter;
        if (codePoint >= 0 && codePoint <= 0x10ffff) output.push(String.fromCodePoint(codePoint));
      }
      let fallback = state.unicodeFallbackLength;
      while (fallback > 0 && index < source.length) {
        if (
          source[index] === '\\' &&
          source[index + 1] === "'" &&
          /^[0-9a-f]{2}$/i.test(source.slice(index + 2, index + 4))
        ) {
          index += 4;
        } else {
          index += 1;
        }
        fallback -= 1;
      }
      continue;
    }
    const visible = RTF_VISIBLE_CONTROLS[controlWord];
    if (!state.skip && visible) output.push(visible);
  }

  return output
    .join('')
    .split('\u0000')
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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
  if (
    ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    ['png', 'jpg', 'jpeg', 'webp'].includes(suffix)
  ) {
    return 'image' as const;
  }
  if (
    ['txt', 'md', 'rtf', 'tex', 'rst', 'csv', 'yaml', 'yml'].includes(suffix) ||
    file.type === 'application/rtf' ||
    file.type === 'text/rtf' ||
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
      reason: 'Use ModelIR JSON, Python, PNG/JPEG/WebP, PDF, DOCX, RTF, Markdown, or text files.',
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
    const rawText = await file.text();
    const rtfSource =
      extension(file.name) === 'rtf' || /^(?:application|text)\/rtf$/i.test(file.type);
    const content = rtfSource ? extractRtfText(rawText) : rawText;
    if (rtfSource && !content) {
      return { ok: false, reason: 'RTF source is malformed or contains no visible text.' };
    }
    return {
      ok: true,
      artifact: {
        name: file.name,
        mediaType: file.type || (kind === 'python' ? 'text/x-python' : 'text/plain'),
        kind,
        encoding: 'utf8',
        content,
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
              : extension(file.name) === 'webp'
                ? 'image/webp'
                : 'image/jpeg'),
      kind,
      encoding: 'base64',
      content: base64From(new Uint8Array(await file.arrayBuffer())),
    },
  };
}

/**
 * Model Assistant attachments share the bounded artifact transport used by the builder, but JSON is
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

function isModelBuildProgress(value: unknown): value is ModelBuildProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const progress = value as Record<string, unknown>;
  return (
    typeof progress.phase === 'string' &&
    [
      'cache-checking',
      'cache-hit',
      'cache-miss',
      'request-validated',
      'selection-resolved',
      'sources-preparing',
      'sources-prepared',
      'llm-running',
      'model-ir-validating',
      'model-ir-repairing',
      'model-ir-validated',
      'failed',
    ].includes(progress.phase) &&
    typeof progress.message === 'string'
  );
}

function validatedModelBuildResult(
  value: unknown,
  sourceArtifactNames: readonly string[],
): ModelBuildResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Model builder result was invalid.');
  }
  const candidate = value as { model?: unknown; trace?: unknown };
  const parsed = parseModelImportJson(JSON.stringify(candidate.model), {
    enforceSourceOutputContracts: true,
    allowSubgraphs: false,
    sourceArtifactNames,
  });
  if (!parsed.ok) throw new Error(`Generated ModelIR was invalid: ${parsed.reason}`);
  if (!stringArray(candidate.trace)) throw new Error('Model builder trace was invalid.');
  return { model: parsed.model, trace: candidate.trace };
}

export function createModelBuilder(fetchImpl: FetchLike = modelLabFetch) {
  return {
    async build(
      artifacts: readonly ModelBuildArtifact[],
      selection?: ModelLabModelSelection,
      options?: ModelBuildOptions,
    ): Promise<ModelBuildResult> {
      const checkCancellation = () => {
        if (options?.signal?.aborted) throw Error('model_copilot_aborted');
      };
      checkCancellation();
      const response = await fetchImpl(MODEL_BUILDER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson, application/json',
        },
        body: JSON.stringify({ artifacts, selection }),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      checkCancellation();
      const contentType = response.headers?.get?.('content-type') ?? '';
      if (contentType.includes('application/x-ndjson') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result: ModelBuildResult | null = null;
        try {
          for (;;) {
            checkCancellation();
            const chunk = await reader.read();
            checkCancellation();
            buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            for (;;) {
              const newline = buffer.indexOf('\n');
              if (newline < 0) break;
              const line = buffer.slice(0, newline);
              buffer = buffer.slice(newline + 1);
              if (!line.trim()) continue;
              const event = JSON.parse(line) as unknown;
              if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
              const record = event as Record<string, unknown>;
              if (record.type === 'progress' && isModelBuildProgress(record.progress)) {
                options?.onProgress?.(record.progress);
              } else if (record.type === 'result') {
                result = validatedModelBuildResult(
                  record.result,
                  artifacts.map((artifact) => artifact.name),
                );
              } else if (record.type === 'error') {
                const stage = typeof record.stage === 'string' ? record.stage : 'unknown stage';
                const detail =
                  typeof record.detail === 'string' ? record.detail : 'Model build failed.';
                options?.onProgress?.({
                  phase: 'failed',
                  message: `Failed during ${stage}: ${detail}`,
                });
                throw new Error(detail);
              }
            }
            if (chunk.done) break;
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        if (!response.ok || !result) throw new Error('Model builder returned no result.');
        return result;
      }
      const payload: unknown = await response.json();
      checkCancellation();
      if (!response.ok || !payload || typeof payload !== 'object') {
        const detail =
          payload && typeof payload === 'object' && 'detail' in payload
            ? String(payload.detail)
            : 'model_builder_unavailable';
        throw new Error(detail);
      }
      return validatedModelBuildResult(
        payload,
        artifacts.map((artifact) => artifact.name),
      );
    },
  };
}

export const codexModelBuilder = createModelBuilder();
