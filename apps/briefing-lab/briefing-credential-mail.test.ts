import { expect, it } from 'vitest';
import { isCredentialMail } from './briefing-credential-mail';

const mail = (title: string, text = '') => ({ kind: 'email', title, text });

it('recognizes sign-in code and password reset mails, in English and Korean', () => {
  for (const title of [
    'Your verification code',
    'Your one-time passcode for Example',
    'One time password (OTP) 안내',
    'Single-use code: sign in to Example',
    '[Example] 인증번호 안내',
    '본인확인 인증 코드',
    '보안 코드를 확인하세요',
    '일회용 비밀번호 발급',
    'Password reset requested',
    'Reset your password',
    '비밀번호 재설정 안내',
  ])
    expect(isCredentialMail(mail(title)), title).toBe(true);
  // The phrase at the start of a short body counts as well.
  expect(isCredentialMail(mail('Example sign-in', 'Your verification code is below.'))).toBe(true);
  expect(isCredentialMail({ kind: 'papers', privateOrigin: 'mail', title: 'OTP for login' })).toBe(
    true,
  );
});

it('does not take an ordinary mail for one because "one time" appears somewhere in it', () => {
  // The real case: a 4,000-character mail with "one time" in its body blocked a whole briefing.
  expect(
    isCredentialMail(
      mail('Committee schedule', `${'Agenda item. '.repeat(120)} We met one time last year.`),
    ),
  ).toBe(false);
  expect(isCredentialMail(mail('A one-time offer for subscribers'))).toBe(false);
  expect(isCredentialMail(mail('Seminar: one time only this Friday', 'Join us one time.'))).toBe(
    false,
  );
  expect(
    isCredentialMail(mail('Newsletter', `${'x'.repeat(700)} reset your password in settings`)),
  ).toBe(false);
  // Only mail is ever a credential mail.
  expect(isCredentialMail({ kind: 'papers', title: 'One-time password protocols revisited' })).toBe(
    false,
  );
});
