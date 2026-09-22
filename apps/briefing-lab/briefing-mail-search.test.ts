import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { APPLE_MAIL_READER } from './live-mail';
import {
  resolveMailSearch,
  nativeMailSearchPredicate,
  matchesMailSearch,
} from './briefing-mail-search';
const scope = {
  accountId: 'a',
  mailboxId: 'b',
  days: 10,
  limit: 50,
  subject: '',
  sender: '',
  unreadOnly: false,
  bodyPreview: false,
};
const now = Date.parse('2026-09-10T12:00:00Z');

it('finds a dated Scholar alert beyond the first 250 unrelated messages by applying predicates before the result limit', () => {
  const body = vi.fn(() => 'Must not read body');
  const make = (id: number, sender: string) => ({
    exists: () => true,
    id: () => id,
    dateReceived: () => new Date('2026-09-08T08:00:00Z'),
    readStatus: () => true,
    subject: () => 'New articles',
    sender: () => sender,
    content: body,
    messageId: () => `<${id}@fixture.test>`,
  });
  const messages = Array.from({ length: 302 }, (_, n) =>
    make(n, n === 301 ? 'Google Scholar <scholaralerts-noreply@google.com>' : 'Unrelated sender'),
  );
  const matching = vi.fn(() => [messages[301]]);
  const refs = Object.assign(
    messages.map((m) => () => m),
    { whose: vi.fn(() => matching) },
  );
  const box = { name: () => 'All Mail', mailboxes: () => [], messages: refs };
  const account = {
    id: () => 'a',
    name: () => 'Fixture',
    emailAddresses: () => ['fixture@example.test'],
    mailboxes: () => [box],
  };
  const frames: unknown[] = [];
  const dollar = Object.assign((value: string) => ({ dataUsingEncoding: () => value }), {
    NSFileHandle: {
      fileHandleWithStandardOutput: {
        writeData: (value: string) => frames.push(JSON.parse(value)),
      },
    },
  });
  const run = runInNewContext(`${APPLE_MAIL_READER};run`, {
    Application: () => ({ accounts: () => [account] }),
    ObjC: { import: () => undefined },
    $: dollar,
    Date,
  });
  const result = JSON.parse(
    run([
      JSON.stringify({
        action: 'read',
        accountId: 'a',
        path: ['All Mail'],
        since: '2026-09-01T00:00:00Z',
        scope: { limit: 3, unreadOnly: false, sender: '', subject: '', bodyPreview: false },
        search: {
          query: 'Google Scholar',
          sender: '',
          subject: '',
          account: '',
          from: '2026-09-07T15:00:00.000Z',
          to: '2026-09-08T15:00:00.000Z',
        },
      }),
    ]),
  );
  expect(result.messages.map((m: { id: string }) => m.id)).toEqual(['301']);
  expect(refs.whose).toHaveBeenCalledOnce();
  expect(JSON.stringify(refs.whose.mock.calls)).toContain('scholar');
  expect(body).not.toHaveBeenCalled();
});
it('uses local-day inclusive start/exclusive end; the saved lookback is only the default of a search', () => {
  const search = resolveMailSearch(
    {
      query: 'Google Scholar',
      account: 'personal@example.test',
      from: '2026-09-08',
      to: '2026-09-09',
    },
    scope,
    'Asia/Seoul',
    now,
  )!;
  expect(search).toMatchObject({
    account: 'personal@example.test',
    from: '2026-09-07T15:00:00.000Z',
    to: '2026-09-08T15:00:00.000Z',
  });
  expect(
    matchesMailSearch(
      {
        title: '새 알림',
        sender: '학술검색 <scholaralerts-noreply@google.com>',
        date: search.from,
      },
      search,
    ),
  ).toBe(true);
  expect(
    matchesMailSearch({ title: '새 알림', sender: 'Google Scholar', date: search.to }, search),
  ).toBe(false);
  expect(resolveMailSearch({ query: '' }, scope, 'Asia/Seoul', now)).toBeUndefined();
  // 2026-09-22 user decision: "메일 조회 범위는 Briefing 만들 때만 적용". A search that names an
  // earlier date is searched as asked; the saved days are only what a search without `from` gets.
  expect(
    resolveMailSearch(
      { query: '', from: '2026-08-01', to: '2026-08-02' },
      scope,
      'Asia/Seoul',
      now,
    ),
  ).toMatchObject({ from: '2026-07-31T15:00:00.000Z', to: '2026-08-01T15:00:00.000Z' });
  expect(resolveMailSearch({ query: 'scholar' }, scope, 'Asia/Seoul', now)?.from).toBe(
    new Date(now - scope.days * 86400000).toISOString(),
  );
  // Nothing can have arrived in a window that lies wholly in the future.
  expect(() =>
    resolveMailSearch(
      { query: '', from: '2031-01-01', to: '2031-01-02' },
      scope,
      'Asia/Seoul',
      now,
    ),
  ).toThrow('mail_search_outside_scope');
  // "All mail" is a very early date; it is kept to a sane floor instead of an absurd one.
  expect(
    resolveMailSearch({ query: 'x', from: '0001-01-01' }, scope, 'Asia/Seoul', now)?.from,
  ).toBe('1990-01-01T00:00:00.000Z');
  expect(() =>
    resolveMailSearch({ query: '', from: 'bad-date' }, scope, 'Asia/Seoul', now),
  ).toThrow('mail_search_range_invalid');
  expect(resolveMailSearch({ query: '', from: '2026-08-01' }, scope, 'Asia/Seoul', now)?.from).toBe(
    '2026-07-31T15:00:00.000Z',
  );
});
it('preserves literal sender/subject and unread restrictions in native predicates', () => {
  const search = resolveMailSearch(
    { query: 'Google Scholar', sender: 'Literal "quoted" sender', subject: 'New articles' },
    scope,
    'Asia/Seoul',
    now,
  )!;
  const predicate = nativeMailSearchPredicate(search, {
    sender: 'approved',
    subject: 'allowed',
    unreadOnly: true,
  });
  expect(predicate._and).toEqual(
    expect.arrayContaining([
      { sender: { _contains: 'approved' } },
      { subject: { _contains: 'allowed' } },
      { readStatus: false },
      { sender: { _contains: 'literal "quoted" sender' } },
    ]),
  );
  expect(predicate._and).toHaveLength(9);
});
