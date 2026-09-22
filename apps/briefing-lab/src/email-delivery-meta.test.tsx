import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmailDeliveryMeta } from './email-delivery-meta';
import { emailDeliveryForPrompt } from './mail-account';

it('shows the receiving account address and localized received time, not the summary time', () => {
  const html = renderToStaticMarkup(
    <EmailDeliveryMeta
      account={{ id: 'account-work', name: 'Google', addresses: ['work@example.test'] }}
      receivedAt="2026-09-09T04:22:00Z"
    />,
  );
  expect(html).toContain('받은 계정');
  expect(html).toContain('Google');
  expect(html).toContain('work@example.test');
  expect(html).toContain('9월 9일');
  expect(html).toContain('오후 1:22');
  expect(html).toContain('수신');
  expect(html).not.toContain('요약');
});
it('keeps missing legacy metadata explicit and never fabricates a current timestamp or account', () => {
  const html = renderToStaticMarkup(<EmailDeliveryMeta receivedAt="invalid" />);
  expect(html).toContain('수신 계정 미기록');
  expect(html).toContain('받은 시간 미기록');
  expect(html).not.toContain('<time');
});
it('distinguishes identically named accounts and escapes account metadata', () => {
  const render = (address: string) =>
    renderToStaticMarkup(
      <EmailDeliveryMeta
        account={{ id: address, name: 'Google', addresses: [address] }}
        receivedAt="2026-09-09T04:22:00Z"
      />,
    );
  expect(render('work@example.test')).not.toEqual(render('personal@example.test'));
  expect(render('<script>alert(1)</script>')).not.toContain('<script>');
});
it('projects delivery facts without exposing opaque account IDs or substituting a summary timestamp', () => {
  expect(
    emailDeliveryForPrompt({
      mailAccount: { id: 'internal-account', name: 'Work', addresses: ['work@example.test'] },
      publishedAt: '2026-09-09T04:22:00Z',
    }),
  ).toEqual({
    receivedAt: '2026-09-09T04:22:00Z',
    receivingAccount: { name: 'Work', addresses: ['work@example.test'] },
  });
  expect(emailDeliveryForPrompt({})).toEqual({ receivedAt: null, receivingAccount: null });
  // With the routine time zone, the local receipt day and weekday are added for date resolution.
  expect(
    emailDeliveryForPrompt({ publishedAt: '2026-09-09T04:22:00Z' }, 'Asia/Seoul').receivedLocal,
  ).toBe('2026-09-09 (Wed) 13:22');
});
