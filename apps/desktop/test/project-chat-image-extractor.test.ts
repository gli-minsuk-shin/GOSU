import { randomBytes } from 'node:crypto';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  normalizeProjectChatImage,
  ProjectChatImageExtractionError,
  type ProjectChatImageFormat,
} from '../src/main/project-chat-image-extractor';

async function generatedFixture(format: ProjectChatImageFormat) {
  if (format === 'bmp') return minimalBitmap();
  const image = sharp({
    create: { width: 6, height: 4, channels: 4, background: '#2185d0cc' },
  });
  if (format === 'png') return image.png().toBuffer();
  if (format === 'jpeg') return image.jpeg().toBuffer();
  if (format === 'gif') return image.gif().toBuffer();
  if (format === 'webp') return image.webp().toBuffer();
  if (format === 'tiff') return image.tiff().toBuffer();
  return image.avif().toBuffer();
}

function minimalBitmap(width = 3, height = 2) {
  const bytesPerPixel = 3;
  const rowBytes = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const pixelBytes = rowBytes * height;
  const output = Buffer.alloc(54 + pixelBytes);
  output.write('BM', 0, 'ascii');
  output.writeUInt32LE(output.byteLength, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(pixelBytes, 34);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * rowBytes + x * bytesPerPixel;
      output[offset] = 0x20;
      output[offset + 1] = 0x80;
      output[offset + 2] = 0xe0;
    }
  }
  return output;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function pngWithDeclaredDimensions(width: number, height: number) {
  const bytes = Buffer.from(
    await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer(),
  );
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

async function animatedGif() {
  const width = 2;
  const frameHeight = 2;
  const pixels = Buffer.alloc(width * frameHeight * 2 * 4);
  for (let index = 0; index < width * frameHeight; index += 1) {
    pixels[index * 4] = 0xff;
    pixels[index * 4 + 3] = 0xff;
    const second = width * frameHeight * 4 + index * 4;
    pixels[second + 2] = 0xff;
    pixels[second + 3] = 0xff;
  }
  return sharp(pixels, {
    raw: { width, height: frameHeight * 2, channels: 4, pageHeight: frameHeight },
  })
    .gif({ delay: [20, 20], loop: 0 })
    .toBuffer();
}

describe('normalizeProjectChatImage', () => {
  it.each<ProjectChatImageFormat>(['png', 'jpeg', 'gif', 'webp', 'tiff', 'bmp', 'avif'])(
    'normalizes a minimal %s fixture to a bounded metadata-free JPEG',
    async (format) => {
      const result = await normalizeProjectChatImage(format, await generatedFixture(format));
      const metadata = await sharp(result.bytes).metadata();

      expect(result).toMatchObject({
        format: 'jpeg',
        width: format === 'bmp' ? 3 : 6,
        height: format === 'bmp' ? 2 : 4,
        sourceFormat: format,
        sourceFrameCount: 1,
      });
      expect(result.bytes.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
      expect(metadata).toMatchObject({ format: 'jpeg', hasProfile: false });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    },
  );

  it('cross-checks the requested format against magic and decoded content', async () => {
    const formats: ProjectChatImageFormat[] = ['png', 'jpeg', 'gif', 'webp', 'tiff', 'bmp', 'avif'];
    for (const [index, format] of formats.entries()) {
      const wrongFormat = formats[(index + 1) % formats.length]!;
      await expect(
        normalizeProjectChatImage(wrongFormat, await generatedFixture(format)),
      ).rejects.toMatchObject({ code: 'attachment_invalid' });
    }
  });

  it('rejects corrupt signature-valid content with a generic bounded error', async () => {
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      randomBytes(24),
    ]);

    await expect(normalizeProjectChatImage('png', corrupt)).rejects.toMatchObject({
      name: ProjectChatImageExtractionError.name,
      code: 'attachment_invalid',
    });
  });

  it('rejects sources above either the 40 MP or 16,384-pixel edge limit before decode', async () => {
    await expect(
      normalizeProjectChatImage('png', await pngWithDeclaredDimensions(6_500, 6_500)),
    ).rejects.toMatchObject({ code: 'attachment_too_large' });
    await expect(
      normalizeProjectChatImage('png', await pngWithDeclaredDimensions(16_385, 1)),
    ).rejects.toMatchObject({ code: 'attachment_too_large' });
  });

  it('auto-orients, strips metadata, downsizes, and composites transparency onto white', async () => {
    const oriented = await sharp({
      create: { width: 3_000, height: 1_000, channels: 4, background: '#00000000' },
    })
      .png()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await normalizeProjectChatImage('png', oriented);
    const metadata = await sharp(result.bytes).metadata();
    const firstPixel = await sharp(result.bytes).raw().toBuffer();

    expect(result).toMatchObject({ width: 683, height: 2_048, sourceFrameCount: 1 });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect([...firstPixel.subarray(0, 3)]).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(firstPixel[0]).toBeGreaterThanOrEqual(250);
    expect(firstPixel[1]).toBeGreaterThanOrEqual(250);
    expect(firstPixel[2]).toBeGreaterThanOrEqual(250);
  });

  it('records the source frame count but normalizes only the first animated frame', async () => {
    const result = await normalizeProjectChatImage('gif', await animatedGif());
    const pixel = await sharp(result.bytes).raw().toBuffer();

    expect(result).toMatchObject({ width: 2, height: 2, sourceFrameCount: 2 });
    expect(pixel[0]).toBeGreaterThan(200);
    expect(pixel[1]).toBeLessThan(60);
    expect(pixel[2]).toBeLessThan(60);
  });

  it('rejects truncated and unsupported BMP encodings without invoking an optional decoder', async () => {
    const truncated = minimalBitmap().subarray(0, 54);
    const compressed = minimalBitmap();
    compressed.writeUInt32LE(1, 30);
    const falseFileSize = minimalBitmap();
    falseFileSize.writeUInt32LE(54, 2);

    await expect(normalizeProjectChatImage('bmp', truncated)).rejects.toMatchObject({
      code: 'attachment_invalid',
    });
    await expect(normalizeProjectChatImage('bmp', compressed)).rejects.toMatchObject({
      code: 'attachment_invalid',
    });
    await expect(normalizeProjectChatImage('bmp', falseFileSize)).rejects.toMatchObject({
      code: 'attachment_invalid',
    });
  });
});
