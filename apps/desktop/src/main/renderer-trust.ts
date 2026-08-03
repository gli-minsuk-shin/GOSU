import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type TrustedRenderer =
  | { mode: 'development'; entryUrl: string; origin: string }
  | { mode: 'production'; entryUrl: string };

type TrustedRendererOptions = {
  developmentUrl: string | undefined;
  isPackaged: boolean;
  productionEntryPath: string;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function createTrustedRenderer({
  developmentUrl,
  isPackaged,
  productionEntryPath,
}: TrustedRendererOptions): TrustedRenderer {
  if (isPackaged || !developmentUrl) {
    return {
      mode: 'production',
      entryUrl: pathToFileURL(resolve(productionEntryPath)).href,
    };
  }

  const entry = new URL(developmentUrl);
  if (
    !['http:', 'https:'].includes(entry.protocol) ||
    !LOOPBACK_HOSTS.has(entry.hostname) ||
    !entry.port ||
    entry.username ||
    entry.password
  ) {
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

export function rendererContentSecurityPolicy(trusted: TrustedRenderer) {
  const common =
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'";
  if (trusted.mode === 'production') {
    return `${common}; script-src 'self'; connect-src 'self'`;
  }

  const rendererUrl = new URL(trusted.origin);
  const websocketOrigin = `${rendererUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${rendererUrl.host}`;
  // Vite injects the React refresh bootstrap inline in development. This exception is scoped to
  // the exact trusted dev origin and is never present in the packaged application policy.
  return `${common}; script-src 'self' 'unsafe-inline'; connect-src 'self' ${websocketOrigin}`;
}
