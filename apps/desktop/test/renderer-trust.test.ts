import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  createTrustedRenderer,
  isTrustedRendererUrl,
  rendererContentSecurityPolicy,
} from '../src/main/renderer-trust';

describe('renderer trust boundary', () => {
  it('accepts only the exact production file entry', () => {
    const entry = resolve('/tmp/gosu/renderer/index.html');
    const trusted = createTrustedRenderer({
      developmentUrl: undefined,
      isPackaged: true,
      productionEntryPath: entry,
    });

    expect(isTrustedRendererUrl(pathToFileURL(entry).href, trusted)).toBe(true);
    expect(
      isTrustedRendererUrl(pathToFileURL(resolve(entry, '..', 'other.html')).href, trusted),
    ).toBe(false);
    expect(isTrustedRendererUrl(`${pathToFileURL(entry).href}?untrusted=1`, trusted)).toBe(false);
    expect(isTrustedRendererUrl('file:///tmp/gosu/renderer/index.html.evil', trusted)).toBe(false);
  });

  it('compares development URLs by exact origin instead of prefix', () => {
    const trusted = createTrustedRenderer({
      developmentUrl: 'http://127.0.0.1:5173/',
      isPackaged: false,
      productionEntryPath: '/unused',
    });

    expect(isTrustedRendererUrl('http://127.0.0.1:5173/editor', trusted)).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:51730/editor', trusted)).toBe(false);
    expect(isTrustedRendererUrl('http://127.0.0.1:5173.evil.test/editor', trusted)).toBe(false);
    expect(isTrustedRendererUrl('https://127.0.0.1:5173/editor', trusted)).toBe(false);
  });

  it('rejects non-web and credential-bearing development entries', () => {
    for (const developmentUrl of [
      'file:///tmp/index.html',
      'https://user:pass@localhost:5173',
      'https://example.test:5173',
      'http://localhost',
    ]) {
      expect(() =>
        createTrustedRenderer({
          developmentUrl,
          isPackaged: false,
          productionEntryPath: '/unused',
        }),
      ).toThrow('invalid_electron_renderer_url');
    }
  });

  it('ignores development URL overrides in packaged builds', () => {
    const entry = resolve('/tmp/gosu/renderer/index.html');
    const trusted = createTrustedRenderer({
      developmentUrl: 'https://attacker.example:5173/',
      isPackaged: true,
      productionEntryPath: entry,
    });

    expect(trusted).toEqual({ mode: 'production', entryUrl: pathToFileURL(entry).href });
  });

  it('allows the Vite bootstrap only in development CSP', () => {
    const development = rendererContentSecurityPolicy(
      createTrustedRenderer({
        developmentUrl: 'http://localhost:5173/',
        isPackaged: false,
        productionEntryPath: '/unused',
      }),
    );
    const production = rendererContentSecurityPolicy(
      createTrustedRenderer({
        developmentUrl: undefined,
        isPackaged: true,
        productionEntryPath: '/tmp/gosu/index.html',
      }),
    );

    expect(development).toContain("script-src 'self' 'unsafe-inline'");
    expect(development).toContain("connect-src 'self' ws://localhost:5173");
    expect(production).toContain("script-src 'self'; connect-src 'self'");
    expect(production).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(production).not.toContain('http://127.0.0.1:4000');
  });
});
