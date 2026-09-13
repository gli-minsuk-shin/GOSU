import { lookup } from 'node:dns/promises';
import { request } from 'node:https';

export class SourceRateLimitError extends Error {
  constructor(
    readonly retryAt: number,
    readonly host = 'export.arxiv.org',
    readonly phase: 'http' | 'cooldown' | 'unknown' = 'http',
  ) {
    super('source_rate_limited');
  }
}
export class SourceReadError extends Error {
  constructor(
    code: string,
    readonly host: string,
    readonly phase: 'http' | 'timeout' | 'connection',
    readonly httpStatus?: number,
  ) {
    super(code);
  }
}
export function sourceFailureReceipt(error: unknown) {
  if (error instanceof SourceRateLimitError)
    return {
      host: error.host,
      error: error.message,
      phase: error.phase,
      requestSent: error.phase === 'http' ? true : error.phase === 'cooldown' ? false : null,
      httpStatus: error.phase === 'http' ? 429 : null,
      retryAt: new Date(error.retryAt).toISOString(),
    };
  if (error instanceof SourceReadError)
    return {
      host: error.host,
      error: error.message,
      phase: error.phase,
      httpStatus: error.httpStatus ?? null,
    };
  return undefined;
}
const sourcePauses = new Map<string, number>();
export function sourceRetryAt(value: string | undefined, now = Date.now()) {
  const seconds = value && /^\d+$/.test(value) ? Number(value) : null;
  const date = value ? Date.parse(value) : NaN;
  return (
    now +
    Math.max(120_000, seconds !== null ? seconds * 1000 : Number.isFinite(date) ? date - now : 0)
  );
}

const ROUTES = new Map([
  ['geocoding-api.open-meteo.com', '/v1/search'],
  ['api.open-meteo.com', '/v1/forecast'],
  ['export.arxiv.org', '/api/query'],
  ['api2.openreview.net', '/notes/search'],
  ['api.datacite.org', '/dois'],
  ['api.crossref.org', '/works'],
]);
export function isPublicV4(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && [0, 168].includes(b)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && [18, 19, 51].includes(b)) &&
    !(a === 203 && b === 0)
  );
}
export function assertPublicSourceUrl(url: URL) {
  const doiRecord =
    url.hostname === 'api.crossref.org' &&
    /^\/works\/10\.\d{4,9}%2F[^/]+$/i.test(url.pathname) &&
    !url.search;
  const publisherPath =
    !url.search &&
    ((url.hostname === 'proceedings.mlr.press' &&
      (/^\/$/.test(url.pathname) ||
        /^\/v\d+\/(?:[a-zA-Z0-9_-]+\.html|(?:[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_-]+\.pdf)?$/.test(
          url.pathname,
        ))) ||
      (url.hostname === 'openreview.net' && /^\/pdf\/[a-f0-9]{40}\.pdf$/.test(url.pathname)));
  const openReviewPdf =
    url.hostname === 'openreview.net' &&
    url.pathname === '/pdf' &&
    [...url.searchParams.keys()].join(',') === 'id' &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(url.searchParams.get('id') ?? '');
  const paperPath =
    url.hostname === 'arxiv.org' &&
    /^\/(?:abs|pdf|html)\/(?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})(?:v\d+)?(?:\/[A-Za-z0-9_.-]+\.(?:png|jpg|jpeg|webp))?$/.test(
      url.pathname,
    ) &&
    !url.search;
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    (!paperPath &&
      !publisherPath &&
      !openReviewPdf &&
      !doiRecord &&
      ROUTES.get(url.hostname) !== url.pathname) ||
    url.href.length > 6000
  )
    throw new Error('source_url_denied');
}
/** Fixed hosts only, IPv4 public DNS pinned to the actual TLS request; redirects never followed. */
export async function publicSourceBytes(url: URL, signal: AbortSignal): Promise<Buffer> {
  assertPublicSourceUrl(url);
  if (signal.aborted) throw new Error('source_cancelled');
  const pause = sourcePauses.get(url.hostname);
  if (pause && pause > Date.now()) throw new SourceRateLimitError(pause, url.hostname, 'cooldown');
  if (pause) sourcePauses.delete(url.hostname);
  const limit =
    (['proceedings.mlr.press', 'openreview.net'].includes(url.hostname) &&
      (url.pathname.endsWith('.pdf') || url.pathname === '/pdf')) ||
    (url.hostname === 'arxiv.org' && url.pathname.startsWith('/pdf/'))
      ? 20_000_000
      : url.hostname === 'proceedings.mlr.press'
        ? 8_000_000
        : url.hostname === 'arxiv.org' && /\.(png|jpe?g|webp)$/.test(url.pathname)
          ? 8_000_000
          : 2_000_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  let rejectAbort!: (error: Error) => void;
  const cancelled = new Promise<never>((_r, reject) => {
    rejectAbort = reject;
  });
  void cancelled.catch(() => undefined);
  const cancel = () =>
    rejectAbort(
      signal.aborted
        ? new Error('source_cancelled')
        : new SourceReadError('source_timeout', url.hostname, 'timeout'),
    );
  controller.signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('source_cancelled');
    const addresses = await Promise.race([
      lookup(url.hostname, { family: 4, all: true }),
      cancelled,
    ]);
    if (!addresses.length || addresses.some((item) => !isPublicV4(item.address)))
      throw new Error('source_dns_denied');
    return await Promise.race([
      new Promise<Buffer>((resolve, reject) => {
        const req = request(
          url,
          {
            method: 'GET',
            family: 4,
            signal: controller.signal,
            lookup: (_host, _options, callback) => callback(null, addresses[0]!.address, 4),
            headers: {
              'User-Agent': 'GOSU-Briefing-Lab/0.1 (local research prototype)',
              Accept: 'application/json,application/atom+xml,text/html,application/pdf',
              'Accept-Encoding': 'identity',
            },
          },
          (res) => {
            if (res.statusCode === 429) {
              const retryAt = sourceRetryAt(res.headers['retry-after']);
              sourcePauses.set(url.hostname, retryAt);
              res.destroy();
              reject(new SourceRateLimitError(retryAt, url.hostname, 'http'));
              return;
            }
            if (res.statusCode !== 200) {
              const challenge =
                url.hostname === 'openreview.net' &&
                res.statusCode === 302 &&
                (() => {
                  try {
                    return new URL(res.headers.location ?? '', url).pathname === '/challenge';
                  } catch {
                    return false;
                  }
                })();
              res.destroy();
              reject(
                new SourceReadError(
                  challenge ? 'source_challenge_required' : `source_http_${res.statusCode}`,
                  url.hostname,
                  'http',
                  res.statusCode,
                ),
              );
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > limit) {
                req.destroy();
                reject(new Error('source_response_limit'));
              } else chunks.push(chunk);
            });
            res.on('error', reject);
            res.on('end', () => resolve(Buffer.concat(chunks)));
          },
        );
        req.on('error', reject);
        req.end();
      }),
      cancelled,
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancel);
  }
}
export async function publicSourceText(url: URL, signal: AbortSignal) {
  return (await publicSourceBytes(url, signal)).toString('utf8');
}
