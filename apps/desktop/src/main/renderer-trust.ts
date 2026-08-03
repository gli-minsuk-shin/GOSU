import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type TrustedRenderer =
  | { mode: 'development'; entryUrl: string; origin: string }
  | { mode: 'production'; entryUrl: string };

export function createTrustedRenderer(
  developmentUrl: string | undefined,
  productionEntryPath: string,
): TrustedRenderer {
  if (!developmentUrl) {
    return {
      mode: 'production',
      entryUrl: pathToFileURL(resolve(productionEntryPath)).href,
    };
  }

  const entry = new URL(developmentUrl);
  if (!['http:', 'https:'].includes(entry.protocol) || entry.username || entry.password) {
    throw new Error('invalid_electron_renderer_url');
  }
  return { mode: 'development', entryUrl: entry.href, origin: entry.origin };
}

export function isTrustedRendererUrl(candidate: string, trusted: TrustedRenderer) {
  try {
    const url = new URL(candidate);
    if (trusted.mode === 'development') return url.origin === trusted.origin;
    return url.href === trusted.entryUrl;
  } catch {
    return false;
  }
}
