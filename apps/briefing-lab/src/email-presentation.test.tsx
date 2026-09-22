import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  compareEmails,
  sortEmails,
  normalizedMailSender,
  mailSenderLabel,
} from './email-presentation';
import { EmailDeliveryMeta } from './email-delivery-meta';
import { prioritizeBriefingItems, type BriefingInsight } from './briefing-intelligence';
import { sortSummaryPriority } from './briefing-assistant-summary';
it('orders emails by priority first, then actual receipt time, never summary freshness', () => {
  const rows = [
    { id: 'low-new', importance: 'low', receivedAt: '2026-09-14T12:00:00Z' },
    {
      id: 'high-old',
      importance: 'high',
      receivedAt: '2026-09-13T12:00:00Z',
      summarizedAt: '2026-09-15T12:00:00Z',
    },
    { id: 'medium-new', importance: 'medium', receivedAt: '2026-09-14T11:00:00Z' },
    { id: 'high-new', importance: 'high', receivedAt: '2026-09-14T12:00:00+09:00' },
    { id: 'high-missing', importance: 'high', receivedAt: 'invalid' },
  ];
  const before = [...rows];
  expect(sortEmails(rows, (row) => row).map((r) => r.id)).toEqual([
    'high-new',
    'high-old',
    'high-missing',
    'medium-new',
    'low-new',
  ]);
  expect(rows).toEqual(before);
  expect(compareEmails({ importance: 'high' }, { importance: 'high', receivedAt: 'invalid' })).toBe(
    0,
  );
  const live = rows.map((r) => ({ id: r.id, kind: 'email', publishedAt: r.receivedAt }));
  const insight = {
    overview: '',
    items: rows.map((r) => ({ id: r.id, importance: r.importance })),
  } as BriefingInsight;
  expect(prioritizeBriefingItems(live, insight).map((r) => r.id)).toEqual(
    sortEmails(rows, (r) => r).map((r) => r.id),
  );
  expect(sortSummaryPriority(rows.map((r) => ({ ...r, kind: 'email' }))).map((r) => r.id)).toEqual(
    sortEmails(rows, (r) => r).map((r) => r.id),
  );
});
it('keeps stable ties and existing uncertain/missing triage buckets', () => {
  const rows = [
    { id: 'a', importance: 'high' },
    { id: 'b', importance: 'high' },
    { id: 'u', importance: 'uncertain' },
    { id: 'l', importance: 'low' },
    { id: 'none' },
  ];
  expect(sortEmails(rows, (r) => r).map((r) => r.id)).toEqual(['a', 'b', 'u', 'l', 'none']);
});
it('shows the sender compactly on the same metadata row and retains the complete header in a tooltip', () => {
  const html = renderToStaticMarkup(
    <EmailDeliveryMeta
      sender={'"Research Office" <office@example.test>'}
      account={{ id: 'work', name: 'Work', addresses: ['me@example.test'] }}
      receivedAt="2026-09-14T00:00:00Z"
    />,
  );
  expect(html).toContain('<b>Research Office</b>');
  expect(html).toContain('office@example.test');
  expect(html).toContain('me@example.test');
  expect(html).toContain('→');
  expect(html.match(/briefing-mail-delivery/g)).toHaveLength(1);
  expect(html).not.toContain('<br');
  expect(renderToStaticMarkup(<EmailDeliveryMeta />)).toContain('보낸 사람 미기록');
});
it('does not infer missing identities and strips header control characters without interpreting HTML', () => {
  expect(mailSenderLabel('<solo@example.test>')).toBe('solo@example.test');
  expect(mailSenderLabel('')).toBe('보낸 사람 미기록');
  expect(normalizedMailSender('Name\r\n\u202e <a@example.test>')).toBe('Name <a@example.test>');
  expect(normalizedMailSender('x'.repeat(1001))).toBeUndefined();
  expect(
    renderToStaticMarkup(<EmailDeliveryMeta sender="<script>alert(1)</script>" />),
  ).not.toContain('<script>');
});
