import { expect, it } from 'vitest';
import { scholarCandidates } from './briefing-scholar-alerts';
import type { LiveItem } from './src/live-types';

const alert = (text: string, title = 'Google Scholar alert'): LiveItem => ({
  id: 'fixture-alert',
  kind: 'email',
  title,
  text,
  source: 'Mail',
  readScope: 'mail-preview',
  details: ['scholaralerts-noreply@google.com'],
});
const shop = 'https://scholar.google.com/scholar_url?url=https%3A%2F%2Fshop.example.test%2Foffer';
const entry = (title: string, text: string, url = shop) => `${title}\n${url}\n${text}`;

it.each([
  ['[광고] 신제품 특별 할인', '지금 구매하세요. 50% 할인 쿠폰.'],
  ['[Advertisement] Exclusive offer', 'Shop now and get 50% off.'],
  ['Sponsored: Exclusive offer', 'Buy now for $19.99.'],
])('excludes an explicitly labelled pure commercial candidate: %s', (title, text) => {
  expect(scholarCandidates([alert(entry(title, text))])).toEqual([]);
});

it.each([
  ['Exclusive offer', 'Shop now and get 50% off.'],
  ['[광고] 새 소식 안내', '오늘의 소식을 확인하세요.'],
  ['[Advertisement] Product announcement', 'Buy now.'],
  ['[Advertisement] Product announcement', '50% off.'],
  ['[광고] 학회 참가 안내', '지금 구매하세요. 등록비 50% 할인.'],
  ['[Advertisement] Conference registration', 'Buy now and get 50% off.'],
  ['[광고] 새 논문 소개', '지금 구매하세요. 50% 할인.'],
  ['[Advertisement] New research findings', 'Shop now and get 50% off.'],
  ['[Advertisement] Webinar invitation', 'Buy now and get 50% off.'],
  ['Advertising effects on consumer choices', 'Study of buy now messages and 50% off offers.'],
  ['Latest research newsletter', 'Unsubscribe. Sponsored. Shop now. 50% off.'],
])('keeps ambiguous, academic or incomplete evidence: %s', (title, text) => {
  expect(scholarCandidates([alert(entry(title, text))])).toHaveLength(1);
});

it.each(['https://arxiv.org/abs/2609.12345v1', 'https://doi.org/10.1234/example'])(
  'preserves scholarly identifiers even with advertising language: %s',
  (url) => {
    expect(
      scholarCandidates([
        alert(entry('[Advertisement] Exclusive offer', 'Shop now. 50% off.', url)),
      ]),
    ).toHaveLength(1);
  },
);

it('filters entries independently without removing real papers or consuming the candidate limit', () => {
  const ads = Array.from({ length: 13 }, (_, i) =>
    entry(`[Advertisement] Exclusive offer ${i}`, 'Shop now. 50% off.', `${shop}${i}`),
  ).join('\n\n');
  const paper = entry(
    'A study of stable optimization',
    'Research results.',
    'https://arxiv.org/abs/2609.12345v1',
  );
  const mails = [alert(`${ads}\n\n${paper}`)];
  const before = structuredClone(mails);
  expect(scholarCandidates(mails).map((item) => item.title)).toEqual([
    'A study of stable optimization',
  ]);
  expect(mails).toEqual(before);
});

it('retains linkless citations and does not block based on the entire mail subject', () => {
  expect(
    scholarCandidates([
      alert(
        'A scholarly article title\nA Author - Journal, 2026\nShop now. 50% off.',
        '[광고] Google Scholar alert',
      ),
    ]),
  ).toHaveLength(1);
  expect(
    scholarCandidates([
      alert(
        entry('A potentially useful announcement', 'Shop now. 50% off.'),
        '[광고] Google Scholar alert',
      ),
    ]),
  ).toHaveLength(1);
});

it('handles HTML ad anchors while preserving nearby scholarly anchors', () => {
  const html = `<h3><a href="${shop}">[Advertisement] Exclusive offer</a></h3><p>Shop now. 50% off.</p><h3><a href="https://doi.org/10.1234/example">New scientific findings</a></h3><p>Research abstract.</p>`;
  expect(scholarCandidates([alert(html)]).map((item) => item.title)).toEqual([
    'New scientific findings',
  ]);
});
