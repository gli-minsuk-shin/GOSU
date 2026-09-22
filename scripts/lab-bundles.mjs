import { access, cp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';

const packagedLabDirectories = ['out/model-lab', 'out/briefing-lab'];
const bundlePattern = /\.(?:css|js|mjs)$/;
const reportedAssetLimit = 12;

// Vite names every build's bundles by content hash, so copying over the previous
// desktop copy keeps each earlier build's bundles and electron-builder packages them all.
export async function replaceLabBundle(sourceDirectory, targetDirectory) {
  const entryPath = join(sourceDirectory, 'index.html');
  await access(entryPath).catch(() => {
    throw new Error(`Lab bundle is not built: ${entryPath} is missing`);
  });
  await rm(targetDirectory, { recursive: true, force: true });
  await cp(sourceDirectory, targetDirectory, { recursive: true });
}

// An ASAR archive is an 8-byte size pickle, the pickled JSON header, then the file bytes.
async function asarLayout(handle) {
  const prefix = Buffer.alloc(16);
  await handle.read(prefix, 0, prefix.length, 0);
  const json = Buffer.alloc(prefix.readUInt32LE(12));
  await handle.read(json, 0, json.length, prefix.length);
  return {
    header: JSON.parse(json.toString('utf8')),
    contentOffset: 8 + prefix.readUInt32LE(4),
  };
}

function asarEntry(header, path) {
  let entry = header;
  for (const segment of path.split('/')) entry = entry?.files?.[segment];
  return entry;
}

async function asarText(asar, path) {
  const entry = asarEntry(asar.header, path);
  if (typeof entry?.offset !== 'string') {
    throw new Error(`${asar.path} does not package ${path}`);
  }
  const bytes = Buffer.alloc(entry.size);
  await asar.handle.read(bytes, 0, bytes.length, asar.contentOffset + Number(entry.offset));
  return bytes.toString('utf8');
}

// A bundle is current when index.html names it, or when a bundle reached that way names it
// (lazy chunks, their styles, workers). Hashed names make a plain text match exact enough.
async function unreferencedLabAssets(asar, labDirectory) {
  const unreached = new Set(
    Object.keys(asarEntry(asar.header, `${labDirectory}/assets`)?.files ?? {}).filter((name) =>
      bundlePattern.test(name),
    ),
  );
  const pending = [`${labDirectory}/index.html`];
  while (pending.length > 0) {
    const text = await asarText(asar, pending.pop());
    for (const name of unreached) {
      if (!text.includes(name)) continue;
      unreached.delete(name);
      pending.push(`${labDirectory}/assets/${name}`);
    }
  }
  return [...unreached].sort().map((name) => `${labDirectory}/assets/${name}`);
}

export async function verifyPackagedLabBundles(asarPath) {
  const handle = await open(asarPath, 'r');
  try {
    const asar = { path: asarPath, handle, ...(await asarLayout(handle)) };
    const unreferenced = [];
    for (const labDirectory of packagedLabDirectories) {
      unreferenced.push(...(await unreferencedLabAssets(asar, labDirectory)));
    }
    if (unreferenced.length === 0) return;
    const reported = unreferenced.slice(0, reportedAssetLimit);
    const omitted = unreferenced.length - reported.length;
    throw new Error(
      [
        `${asarPath} packages ${unreferenced.length} lab assets that no page or referenced chunk loads ` +
          '(bundles left over from earlier builds):',
        ...reported.map((path) => `  ${path}`),
        ...(omitted > 0 ? [`  ... and ${omitted} more`] : []),
      ].join('\n'),
    );
  } finally {
    await handle.close();
  }
}
