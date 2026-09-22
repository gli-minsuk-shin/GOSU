export type MailLink = { text: string; href: string };

const MAX_SOURCE = 262_144;
const MAX_LINKS = 100;

function splitEntity(raw: string) {
  const match = /\r?\n\r?\n/.exec(raw);
  return match
    ? { headers: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) }
    : null;
}
function header(headers: string, name: string) {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, ' ');
  return new RegExp(`^${name}:[ \\t]*(.*)$`, 'im').exec(unfolded)?.[1]?.trim() ?? null;
}
function parameter(value: string, key: string) {
  return (
    new RegExp(`;\\s*${key}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i')
      .exec(value)
      ?.slice(1)
      .find(Boolean) ?? null
  );
}
function decodeQuotedPrintable(text: string) {
  const joined = text.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
      continue;
    }
    const code = joined.codePointAt(i)!;
    if (code < 128) bytes.push(code);
    else {
      bytes.push(...Buffer.from(String.fromCodePoint(code), 'utf8'));
      if (code > 0xffff) i++;
    }
  }
  return Buffer.from(bytes);
}
function decodeBody(body: string, encoding: string | null, charset: string | null) {
  const transfer = (encoding ?? '').toLowerCase();
  if (transfer !== 'base64' && transfer !== 'quoted-printable') return body;
  const bytes =
    transfer === 'base64'
      ? Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')
      : decodeQuotedPrintable(body);
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * The first text/html part of a raw message, decoded. Apple Mail's plain-text `content` usually drops
 * the hrefs of an HTML mail (Google Scholar alerts link each paper only from its title), while the
 * raw source keeps them.
 */
export function htmlFromMailSource(raw: string, depth = 0): string | null {
  if (depth > 5 || !raw || raw.length > MAX_SOURCE) return null;
  const entity = splitEntity(raw);
  if (!entity) return null;
  const contentType = header(entity.headers, 'content-type') ?? 'text/plain';
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  if (type.startsWith('multipart/')) {
    const boundary = parameter(contentType, 'boundary');
    if (!boundary) return null;
    for (const part of entity.body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith('--')) break;
      // The line break before a delimiter belongs to the delimiter, not to the part (RFC 2046).
      const body = part.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n$/, '');
      const html = htmlFromMailSource(body, depth + 1);
      if (html) return html;
    }
    return null;
  }
  if (type !== 'text/html') return null;
  return decodeBody(
    entity.body,
    header(entity.headers, 'content-transfer-encoding'),
    parameter(contentType, 'charset'),
  );
}

const entities = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_all, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');

/** Visible text and target of each web link, in document order; nothing is fetched. */
export function linksFromHtml(html: string): MailLink[] {
  const links: MailLink[] = [];
  const seen = new Set<string>();
  const cleaned = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  for (const match of cleaned.matchAll(
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = entities(match[1] ?? match[2] ?? '').trim();
    const text = entities(match[3]!.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (!/^https?:\/\//i.test(href) || !text || href.length > 2048) continue;
    const key = `${text}\n${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ text: text.slice(0, 500), href });
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}

export function mailLinksFromSource(raw: string) {
  const html = htmlFromMailSource(raw);
  return html ? linksFromHtml(html) : [];
}
