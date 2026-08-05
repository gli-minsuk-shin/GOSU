import sharp, { type Sharp } from 'sharp';

import { PROJECT_CHAT_MAX_NORMALIZED_IMAGE_BYTES } from '../shared/project-chat-attachment-contracts';

export type ProjectChatImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'tiff' | 'bmp' | 'avif';

export type NormalizedProjectChatImage = Readonly<{
  format: 'jpeg';
  bytes: Uint8Array;
  width: number;
  height: number;
  sourceFormat: ProjectChatImageFormat;
  sourceFrameCount: number;
}>;

export type ProjectChatImageExtractionErrorCode =
  'attachment_invalid' | 'attachment_too_large' | 'attachment_extraction_failed';

export class ProjectChatImageExtractionError extends Error {
  constructor(readonly code: ProjectChatImageExtractionErrorCode) {
    super(code);
    this.name = 'ProjectChatImageExtractionError';
  }
}

const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_SOURCE_EDGE = 16_384;
const MAX_NORMALIZED_EDGE = 2_048;

const FORMAT_SIGNATURES: Readonly<Record<ProjectChatImageFormat, (bytes: Uint8Array) => boolean>> =
  {
    png: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    jpeg: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
    gif: (bytes) => startsWithAscii(bytes, 'GIF87a') || startsWithAscii(bytes, 'GIF89a'),
    webp: (bytes) =>
      bytes.byteLength >= 12 && startsWithAscii(bytes, 'RIFF') && asciiAt(bytes, 8, 4) === 'WEBP',
    tiff: (bytes) =>
      startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]),
    bmp: (bytes) => startsWithAscii(bytes, 'BM'),
    avif: hasAvifFileTypeBox,
  };

type DecodedSource = Readonly<{
  pipeline: Sharp;
  width: number;
  height: number;
  frameCount: number;
}>;

export async function normalizeProjectChatImage(
  format: ProjectChatImageFormat,
  bytes: Uint8Array,
): Promise<NormalizedProjectChatImage> {
  if (!FORMAT_SIGNATURES[format]?.(bytes)) {
    throw new ProjectChatImageExtractionError('attachment_invalid');
  }

  // Copy the caller-owned view before asynchronous decoding so the validated source cannot change.
  const source = Buffer.from(bytes);
  const decoded =
    format === 'bmp' ? decodeBitmap(source) : await prepareSharpSource(format, source);

  assertSourceDimensions(decoded.width, decoded.height);

  let normalized: Awaited<ReturnType<Sharp['toBuffer']>> & {
    data: Buffer;
    info: { width: number; height: number };
  };
  try {
    normalized = (await decoded.pipeline
      .rotate()
      .resize({
        width: MAX_NORMALIZED_EDGE,
        height: MAX_NORMALIZED_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true })) as typeof normalized;
  } catch {
    throw new ProjectChatImageExtractionError('attachment_extraction_failed');
  }

  if (
    normalized.data.byteLength > PROJECT_CHAT_MAX_NORMALIZED_IMAGE_BYTES ||
    normalized.info.width < 1 ||
    normalized.info.height < 1 ||
    normalized.info.width > MAX_NORMALIZED_EDGE ||
    normalized.info.height > MAX_NORMALIZED_EDGE
  ) {
    throw new ProjectChatImageExtractionError('attachment_too_large');
  }

  return {
    format: 'jpeg',
    bytes: new Uint8Array(normalized.data),
    width: normalized.info.width,
    height: normalized.info.height,
    sourceFormat: format,
    sourceFrameCount: decoded.frameCount,
  };
}

async function prepareSharpSource(
  format: Exclude<ProjectChatImageFormat, 'bmp'>,
  source: Buffer,
): Promise<DecodedSource> {
  const inputOptions = {
    page: 0,
    pages: 1,
    animated: false,
    failOn: 'error' as const,
    limitInputPixels: MAX_SOURCE_PIXELS,
  };
  let metadata: Awaited<ReturnType<Sharp['metadata']>>;
  try {
    metadata = await sharp(source, inputOptions).metadata();
  } catch (error) {
    throw new ProjectChatImageExtractionError(
      isPixelLimitError(error) ? 'attachment_too_large' : 'attachment_invalid',
    );
  }

  if (!metadata.width || !metadata.height || !metadataMatchesFormat(format, metadata.format)) {
    throw new ProjectChatImageExtractionError('attachment_invalid');
  }
  assertSourceDimensions(metadata.width, metadata.height);

  return {
    pipeline: sharp(source, inputOptions),
    width: metadata.width,
    height: metadata.height,
    frameCount:
      Number.isSafeInteger(metadata.pages) && (metadata.pages ?? 0) > 0 ? metadata.pages! : 1,
  };
}

function metadataMatchesFormat(format: Exclude<ProjectChatImageFormat, 'bmp'>, detected?: string) {
  return format === 'avif' ? detected === 'heif' || detected === 'avif' : detected === format;
}

function assertSourceDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new ProjectChatImageExtractionError('attachment_invalid');
  }
  if (width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS) {
    throw new ProjectChatImageExtractionError('attachment_too_large');
  }
}

function decodeBitmap(source: Buffer): DecodedSource {
  if (source.byteLength < 54) {
    throw new ProjectChatImageExtractionError('attachment_invalid');
  }

  const declaredFileSize = source.readUInt32LE(2);
  const pixelOffset = source.readUInt32LE(10);
  const dibSize = source.readUInt32LE(14);
  if (
    dibSize < 40 ||
    14 + dibSize > source.byteLength ||
    pixelOffset < 14 + dibSize ||
    pixelOffset > source.byteLength ||
    (declaredFileSize !== 0 &&
      (declaredFileSize > source.byteLength || declaredFileSize < pixelOffset))
  ) {
    throw new ProjectChatImageExtractionError('attachment_invalid');
  }

  const width = source.readInt32LE(18);
  const signedHeight = source.readInt32LE(22);
  const planes = source.readUInt16LE(26);
  const bitsPerPixel = source.readUInt16LE(28);
  const compression = source.readUInt32LE(30);
  if (
    width < 1 ||
    signedHeight === 0 ||
    signedHeight === -2_147_483_648 ||
    planes !== 1 ||
    (bitsPerPixel !== 24 && bitsPerPixel !== 32) ||
    compression !== 0
  ) {
    throw new ProjectChatImageExtractionError('attachment_invalid');
  }

  const height = Math.abs(signedHeight);
  assertSourceDimensions(width, height);
  const bytesPerPixel = bitsPerPixel / 8;
  const rowBytes = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const pixelBytes = rowBytes * height;
  if (
    !Number.isSafeInteger(pixelBytes) ||
    pixelOffset + pixelBytes > source.byteLength ||
    (declaredFileSize !== 0 && declaredFileSize < pixelOffset + pixelBytes)
  ) {
    throw new ProjectChatImageExtractionError('attachment_invalid');
  }

  const rgba = Buffer.allocUnsafe(width * height * 4);
  const bottomUp = signedHeight > 0;
  for (let outputY = 0; outputY < height; outputY += 1) {
    const sourceY = bottomUp ? height - outputY - 1 : outputY;
    const sourceRow = pixelOffset + sourceY * rowBytes;
    const outputRow = outputY * width * 4;
    for (let x = 0; x < width; x += 1) {
      const sourcePixel = sourceRow + x * bytesPerPixel;
      const outputPixel = outputRow + x * 4;
      rgba[outputPixel] = source[sourcePixel + 2]!;
      rgba[outputPixel + 1] = source[sourcePixel + 1]!;
      rgba[outputPixel + 2] = source[sourcePixel]!;
      // BI_RGB reserves the fourth byte rather than defining reliable alpha semantics.
      rgba[outputPixel + 3] = 0xff;
    }
  }

  return {
    pipeline: sharp(rgba, { raw: { width, height, channels: 4 } }),
    width,
    height,
    frameCount: 1,
  };
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return (
    bytes.byteLength >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

function startsWithAscii(bytes: Uint8Array, value: string) {
  return asciiAt(bytes, 0, value.length) === value;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function hasAvifFileTypeBox(bytes: Uint8Array) {
  if (bytes.byteLength < 16 || asciiAt(bytes, 4, 4) !== 'ftyp') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = view.getUint32(0, false);
  if (boxSize < 16 || boxSize > bytes.byteLength || (boxSize - 8) % 4 !== 0) return false;
  for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
    const brand = asciiAt(bytes, offset, 4);
    if (brand === 'avif' || brand === 'avis') return true;
  }
  return false;
}

function isPixelLimitError(error: unknown) {
  return error instanceof Error && /pixel limit/iu.test(error.message);
}
