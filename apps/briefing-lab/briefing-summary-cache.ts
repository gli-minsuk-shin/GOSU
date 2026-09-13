import { createHash } from 'node:crypto';
import type { LiveItem } from './src/live-types';
import type { InterestProfile, MailScope } from '@gosu/briefing-core';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Exact observed input, never a fuzzy title match. No source text is persisted by this helper.
export function summarySourceDigest(item: LiveItem) {
  if (item.kind === 'email' && item.mailContentProof)
    return digest({
      version: 'verified-mail-v1',
      proof: item.mailContentProof,
      title: item.title,
      text: item.text,
      readScope: item.readScope,
      sender: item.details[0],
    });
  return digest({
    id: item.id,
    kind: item.kind,
    title: item.title,
    text: item.text,
    source: item.source,
    sourceUrl: item.sourceUrl ?? null,
    publishedAt: item.publishedAt ?? null,
    readScope: item.readScope,
    details: item.details,
    privateOrigin: item.privateOrigin ?? null,
    paper: item.paper
      ? {
          readScope: item.paper.readScope,
          excerpt: item.paper.excerpt,
          sourceUrl: item.paper.sourceUrl,
          equations: item.paper.equations.map(({ id, latex }) => ({ id, latex })),
          figures: item.paper.figures.map(({ id, caption, assetUrl }) => ({
            id,
            caption,
            assetUrl,
          })),
        }
      : null,
  });
}
export function summaryContextDigest(
  item: LiveItem,
  interest: InterestProfile,
  mail?: MailScope | null,
) {
  return digest({
    template: 'briefing-summary-v1',
    interest: item.kind === 'papers' ? interest : null,
    mail: item.kind === 'email' || item.privateOrigin === 'mail' ? (mail ?? null) : null,
  });
}
