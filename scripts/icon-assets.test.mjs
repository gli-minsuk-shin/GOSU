import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const desktopRoot = join(repositoryRoot, 'apps', 'desktop');

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbaPng(png) {
  let offset = 8;
  let width;
  let height;
  const compressed = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'icon PNG must use 8-bit channels');
      assert.equal(data[9], 6, 'icon PNG must use RGBA color');
      assert.equal(data[12], 0, 'icon PNG must not be interlaced');
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  assert.equal(typeof width, 'number');
  assert.equal(typeof height, 'number');
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  let filteredOffset = 0;

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const filter = filtered[filteredOffset];
    filteredOffset += 1;
    const row = Buffer.alloc(stride);
    for (let column = 0; column < stride; column += 1) {
      const source = filtered[filteredOffset + column];
      const left = column >= bytesPerPixel ? row[column - bytesPerPixel] : 0;
      const above = previous[column];
      const upperLeft = column >= bytesPerPixel ? previous[column - bytesPerPixel] : 0;
      switch (filter) {
        case 0:
          row[column] = source;
          break;
        case 1:
          row[column] = (source + left) & 0xff;
          break;
        case 2:
          row[column] = (source + above) & 0xff;
          break;
        case 3:
          row[column] = (source + Math.floor((left + above) / 2)) & 0xff;
          break;
        case 4:
          row[column] = (source + paethPredictor(left, above, upperLeft)) & 0xff;
          break;
        default:
          assert.fail(`unsupported PNG row filter ${String(filter)}`);
      }
    }
    row.copy(pixels, rowIndex * stride);
    previous = row;
    filteredOffset += stride;
  }

  return { width, height, pixels };
}

function alphaAt(decoded, x, y) {
  return decoded.pixels[(y * decoded.width + x) * 4 + 3];
}

function readIcnsChunk(icns, expectedType) {
  let offset = 8;
  while (offset < icns.length) {
    const type = icns.subarray(offset, offset + 4).toString('ascii');
    const length = icns.readUInt32BE(offset + 4);
    assert.ok(length >= 8, `invalid ICNS ${type} chunk length`);
    if (type === expectedType) return icns.subarray(offset + 8, offset + length);
    offset += length;
  }
  assert.fail(`missing ICNS ${expectedType} chunk`);
}

test('packages the GOSU icon instead of the Electron default', async () => {
  const packageJson = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
  const source = await readFile(join(desktopRoot, 'build', 'icon-source.png'));
  const png = await readFile(join(desktopRoot, 'build', 'icon.png'));
  const icns = await readFile(join(desktopRoot, 'build', 'icon.icns'));

  assert.equal(packageJson.build.mac.icon, 'build/icon.icns');
  assert.equal(packageJson.build.dmg.icon, 'build/icon.icns');

  assert.deepEqual(
    source.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  assert.equal(source.readUInt32BE(16), source.readUInt32BE(20));
  assert.ok(source.readUInt32BE(16) >= 1024, 'editable icon source must remain high resolution');

  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);

  const decoded = decodeRgbaPng(png);
  for (const [x, y] of [
    [0, 0],
    [decoded.width - 1, 0],
    [0, decoded.height - 1],
    [decoded.width - 1, decoded.height - 1],
  ]) {
    assert.equal(alphaAt(decoded, x, y), 0, `icon corner ${x},${y} must be transparent`);
  }
  for (const [x, y] of [
    [128, 128],
    [decoded.width - 129, 128],
    [128, decoded.height - 129],
    [decoded.width - 129, decoded.height - 129],
  ]) {
    assert.equal(alphaAt(decoded, x, y), 0, `inset corner ${x},${y} must be transparent`);
  }
  for (const [x, y] of [
    [Math.floor(decoded.width / 2), 128],
    [128, Math.floor(decoded.height / 2)],
    [decoded.width - 129, Math.floor(decoded.height / 2)],
    [Math.floor(decoded.width / 2), decoded.height - 129],
  ]) {
    assert.equal(alphaAt(decoded, x, y), 255, `edge midpoint ${x},${y} must be opaque`);
  }
  assert.equal(
    alphaAt(decoded, Math.floor(decoded.width / 2), Math.floor(decoded.height / 2)),
    255,
    'icon center must be opaque',
  );
  let transparentPixels = 0;
  let opaquePixels = 0;
  for (let index = 3; index < decoded.pixels.length; index += 4) {
    if (decoded.pixels[index] === 0) transparentPixels += 1;
    if (decoded.pixels[index] === 255) opaquePixels += 1;
  }
  const totalPixels = decoded.width * decoded.height;
  assert.ok(transparentPixels > totalPixels * 0.25, 'icon must have substantial corner padding');
  assert.ok(opaquePixels > totalPixels * 0.5, 'icon squircle must retain a substantial face');

  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.deepEqual(readIcnsChunk(icns, 'ic10'), png, 'ICNS 1024px rendition must match icon.png');
});
