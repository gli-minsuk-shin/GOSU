import { describe, expect, it } from 'vitest';
import { createOverleafExport, inspectObsidianMarkdown, connectorRegistry } from '../src/index';

describe('integration capability boundaries', () => {
  it('keeps Overleaf export-only and Zotero read-only', () => {
    expect(connectorRegistry.overleaf.capabilities).toMatchObject({
      read: false,
      write: false,
      export: true,
    });
    expect(connectorRegistry.zotero.capabilities).toMatchObject({
      read: true,
      write: false,
      attachments: false,
    });
  });

  it('extracts local wikilinks without retaining note content', () => {
    const metadata = inspectObsidianMarkdown(
      '---\ntags: [research, local]\n---\nSee [[Trial 8]] and [[Metric v3|metric]].',
    );
    expect(metadata.frontmatter.tags).toEqual(['research', 'local']);
    expect(metadata.wikilinks).toEqual(['Trial 8', 'Metric v3']);
    expect(JSON.stringify(metadata)).not.toContain('See');
  });

  it('binds Overleaf exports to a full commit and archive hash', () => {
    const result = createOverleafExport({
      repository: 'gli-minsuk-shin/GOSU',
      commitSha: 'a'.repeat(40),
      rootDocument: 'paper/main.tex',
      zip: new Uint8Array([1, 2, 3]),
    });
    expect(result.manifest.direction).toBe('one_way');
    expect(result.manifest.archiveSha256).toHaveLength(64);
  });
});
