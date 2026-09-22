import { describe, expect, it } from 'vitest';
import {
  guidanceSenderRules,
  matchesGuidanceSender,
  normalizedGuidanceText,
  senderAddress,
} from './briefing-guidance';

const item = (id: string, text: string) => ({ id, text });

describe('briefing guidance sender rules', () => {
  it('reads addresses and domains the user wrote, including ones followed by Korean particles', () => {
    expect(
      guidanceSenderRules([
        item('a', 'Kim.Prof@Yonsei.ac.kr에서 온 메일은 반드시 포함'),
        item('b', '한국연구재단(nrf.re.kr)과 @kaist.ac.kr 메일은 중요하게'),
        item('c', 'GOSU 0.58.111 관련, e.g. 새 논문은 짧게'),
      ]),
    ).toEqual([
      { itemId: 'a', kind: 'address', value: 'kim.prof@yonsei.ac.kr' },
      { itemId: 'b', kind: 'domain', value: 'nrf.re.kr' },
      { itemId: 'b', kind: 'domain', value: 'kaist.ac.kr' },
    ]);
  });

  it('matches the sender address exactly or by domain and subdomain, never by display text', () => {
    const rules = guidanceSenderRules([
      item('a', 'kim.prof@yonsei.ac.kr'),
      item('b', 'nrf.re.kr 메일'),
    ]);
    expect(senderAddress('김교수 <Kim.Prof@Yonsei.ac.kr>')).toBe('kim.prof@yonsei.ac.kr');
    expect(senderAddress('noreply@mail.nrf.re.kr')).toBe('noreply@mail.nrf.re.kr');
    expect(senderAddress('보낸 사람 미기록')).toBeNull();
    expect(matchesGuidanceSender('김교수 <kim.prof@yonsei.ac.kr>', rules)).toBe(true);
    expect(matchesGuidanceSender('Other <other@yonsei.ac.kr>', rules)).toBe(false);
    expect(matchesGuidanceSender('NRF <noreply@mail.nrf.re.kr>', rules)).toBe(true);
    // A look-alike domain or the domain only in the display name is not a match.
    expect(matchesGuidanceSender('x <a@notnrf.re.kr>', rules)).toBe(false);
    expect(matchesGuidanceSender('nrf.re.kr <spoof@example.com>', rules)).toBe(false);
    expect(matchesGuidanceSender(undefined, rules)).toBe(false);
    expect(matchesGuidanceSender('kim.prof@yonsei.ac.kr', [])).toBe(false);
  });

  it('keeps one guidance line as one trimmed line', () => {
    expect(normalizedGuidanceText('  연구처 메일은\n  반드시   포함  ')).toBe(
      '연구처 메일은 반드시 포함',
    );
  });
});
