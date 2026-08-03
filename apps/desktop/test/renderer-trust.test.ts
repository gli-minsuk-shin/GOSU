import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createTrustedRenderer, isTrustedRendererUrl } from '../src/main/renderer-trust';

describe('renderer trust boundary', () => {
  it('accepts only the exact production file entry', () => {
    const entry = resolve('/tmp/gosu/renderer/index.html');
    const trusted = createTrustedRenderer(undefined, entry);

    expect(isTrustedRendererUrl(pathToFileURL(entry).href, trusted)).toBe(true);
    expect(
      isTrustedRendererUrl(pathToFileURL(resolve(entry, '..', 'other.html')).href, trusted),
    ).toBe(false);
    expect(isTrustedRendererUrl(`${pathToFileURL(entry).href}?untrusted=1`, trusted)).toBe(false);
    expect(isTrustedRendererUrl('file:///tmp/gosu/renderer/index.html.evil', trusted)).toBe(false);
  });

  it('compares development URLs by exact origin instead of prefix', () => {
    const trusted = createTrustedRenderer('http://127.0.0.1:5173/', '/unused');

    expect(isTrustedRendererUrl('http://127.0.0.1:5173/editor', trusted)).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:51730/editor', trusted)).toBe(false);
    expect(isTrustedRendererUrl('http://127.0.0.1:5173.evil.test/editor', trusted)).toBe(false);
    expect(isTrustedRendererUrl('https://127.0.0.1:5173/editor', trusted)).toBe(false);
  });

  it('rejects non-web and credential-bearing development entries', () => {
    expect(() => createTrustedRenderer('file:///tmp/index.html', '/unused')).toThrow(
      'invalid_electron_renderer_url',
    );
    expect(() => createTrustedRenderer('https://user:pass@example.test', '/unused')).toThrow(
      'invalid_electron_renderer_url',
    );
  });
});
