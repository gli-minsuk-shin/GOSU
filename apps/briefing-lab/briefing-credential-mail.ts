/**
 * Sign-in codes, one-time passcodes and password resets. Such a mail is never sent to a model and
 * never saved in a briefing. It is decided per mail: one of them in a batch used to make the whole
 * batch unsaveable, which the run then treated as a storage failure, stopped every other batch and
 * never reached the papers, again at every run until that mail aged out of the read window.
 */
const CREDENTIAL_PHRASE =
  /verification code|security code|login code|sign[- ]?in code|(?:one[- ]time|single[- ]use)\s+(?:pass(?:code|word)?|code|pin|link)|\botp\b|인증\s*(?:번호|코드)|보안\s*코드|일회용\s*(?:비밀번호|코드|번호)|password reset|reset your password|비밀번호\s*(?:재설정|초기화|변경\s*안내)/i;

/** Such mails are short and say so at the start; a phrase deep in a long mail does not count. */
const BODY_WINDOW = 600;

export function isCredentialMail(item: {
  kind?: string | undefined;
  privateOrigin?: string | undefined;
  title?: string | undefined;
  text?: string | undefined;
}) {
  if (item.kind !== 'email' && item.privateOrigin !== 'mail') return false;
  return (
    CREDENTIAL_PHRASE.test(item.title ?? '') ||
    CREDENTIAL_PHRASE.test((item.text ?? '').slice(0, BODY_WINDOW))
  );
}
