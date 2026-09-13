/** Conservative local evidence rule, not a guarantee of advertising intent.
 * Missing/ambiguous evidence always passes. Never apply to a whole mixed digest.
 */
export function isExplicitCommercialPaperCandidate(
  title: string,
  excerpt: string,
  hasScholarlyLink: boolean,
) {
  if (hasScholarlyLink) return false;
  const text = `${title}\n${excerpt}`.normalize('NFKC');
  // Academic and actionable research announcements win over commercial signals.
  if (
    /논문|연구|학술|학회|저널|세미나|웨비나|초록|초청|초대|모집|장학|과제|발표|등록|\b(?:research|papers?|stud(?:y|ies)|journal|conference|workshop|seminar|webinar|abstract|authors?|findings|methods?|results?|arxiv|doi|preprint|symposium|invitation|registration|fellowship|grant|call for)\b/i.test(
      text,
    )
  )
    return false;
  const labelled =
    /^\s*(?:\[광고\]|\(광고\)|\[(?:ad|advertisement|sponsored)\]|(?:advertisement|sponsored)\s*:)/i.test(
      title.normalize('NFKC'),
    );
  const purchase =
    /지금\s*(?:구매|주문)|구매하세요|주문하세요|\b(?:buy now|shop now|order now|add to cart|use (?:code|coupon))\b/i.test(
      text,
    );
  const offer =
    /\d+\s*%\s*(?:할인|off)|(?:할인|쿠폰)\s*(?:코드|혜택)|[$€£]\s*\d+(?:[.,]\d+)?|\d[\d,]*\s*원\b/i.test(
      text,
    );
  return labelled && purchase && offer;
}
