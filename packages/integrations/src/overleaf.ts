import { createHash } from 'node:crypto';

export type OverleafExportManifest = {
  schemaVersion: 1;
  repository: string;
  commitSha: string;
  rootDocument: string;
  archiveSha256: string;
  exportedAt: string;
  direction: 'one_way';
};

export function createOverleafExport(input: {
  repository: string;
  commitSha: string;
  rootDocument: string;
  zip: Uint8Array;
}) {
  if (!/^[a-f0-9]{40}$/i.test(input.commitSha)) {
    throw new Error('full_commit_sha_required');
  }
  if (!input.rootDocument.endsWith('.tex')) {
    throw new Error('tex_root_required');
  }

  const manifest: OverleafExportManifest = {
    schemaVersion: 1,
    repository: input.repository,
    commitSha: input.commitSha,
    rootDocument: input.rootDocument,
    archiveSha256: createHash('sha256').update(input.zip).digest('hex'),
    exportedAt: new Date().toISOString(),
    direction: 'one_way',
  };

  return {
    endpoint: 'https://www.overleaf.com/docs',
    fields: {
      snip_name: `${input.repository}@${input.commitSha.slice(0, 12)}`,
      encoded_snip: Buffer.from(input.zip).toString('base64'),
    },
    manifest,
  };
}
