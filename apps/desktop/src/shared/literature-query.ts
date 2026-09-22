/**
 * What a literature search text means, without any provider or model.
 *
 * Main uses these terms to refuse results that never mention the topic, and the renderer uses the
 * planning trigger to decide when a sentence should be turned into keyword queries first.
 */

export const LITERATURE_MAX_QUERY_TERMS = 24;

const ENGLISH_STOP_WORDS = new Set(
  (
    'a an the of for and or in on at to from by with without via using use based about into over ' +
    'under between among is are be was were as its their this that these those we our it can how ' +
    'what which why when where who do does not no vs versus etc toward towards than then also new ' +
    'novel recent latest state art find search look looking show give list recommend please want ' +
    'need like would paper papers literature article articles study studies research survey ' +
    'surveys review reviews work works related relevant'
  ).split(' '),
);

const KOREAN_STOP_WORDS = new Set(
  (
    '논문 문헌 연구 검색 서치 조사 서베이 리뷰 관련 관련된 대한 대해 대해서 위한 통한 중심 최근 최신 ' +
    '대표 정리 분석 방법 기반 그리고 또는 각각 나눠서 나눠 이런 저런 어떤 무슨 자료'
  ).split(' '),
);

const KOREAN_PARTICLES = [
  '에서는',
  '으로는',
  '에서',
  '으로',
  '에게',
  '까지',
  '부터',
  '이랑',
  '이나',
  '을',
  '를',
  '이',
  '가',
  '은',
  '는',
  '의',
  '에',
  '로',
  '와',
  '과',
  '도',
  '만',
  '들',
  '랑',
  '나',
];

const KOREAN_REQUEST_PATTERN =
  /^(?:찾아|찾기|알려|보여|추천)|(?:해줘|해줘요|해주세요|해주라|해봐|해라|하자|합니다|했다|하는|해서|할래|줄래|주세요)$/u;

const HANGUL_PATTERN = /\p{Script=Hangul}/u;
const NON_LATIN_LETTER_PATTERN = /(?!\p{Script=Latin})\p{L}/u;
const REQUEST_OPENING_PATTERN =
  /^\s*(?:please\s+)?(?:find|search|look|show|give|list|recommend|summari[sz]e|what|which|how|why|can|could|i|we)\b/iu;

function splitWords(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

function withoutKoreanParticle(word: string) {
  if (!HANGUL_PATTERN.test(word)) return word;
  for (const particle of KOREAN_PARTICLES) {
    if (word.endsWith(particle) && word.length - particle.length >= 2) {
      return word.slice(0, word.length - particle.length);
    }
  }
  return word;
}

function isTopicWord(word: string) {
  if (HANGUL_PATTERN.test(word)) {
    return word.length >= 2 && !KOREAN_STOP_WORDS.has(word) && !KOREAN_REQUEST_PATTERN.test(word);
  }
  if (ENGLISH_STOP_WORDS.has(word)) return false;
  return word.length >= 3 || (word.length === 2 && /\p{N}/u.test(word));
}

/** Topic words of a search text: lowercased, deduplicated, without request or filler words. */
export function literatureQueryTerms(text: string): string[] {
  const terms: string[] = [];
  for (const raw of splitWords(text)) {
    if (HANGUL_PATTERN.test(raw) && KOREAN_REQUEST_PATTERN.test(raw)) continue;
    const word = withoutKoreanParticle(raw);
    if (!isTopicWord(word) || terms.includes(word)) continue;
    terms.push(word);
    if (terms.length === LITERATURE_MAX_QUERY_TERMS) break;
  }
  return terms;
}

function sharesStem(term: string, word: string) {
  if (term === word) return true;
  const [shorter, longer] = term.length <= word.length ? [term, word] : [word, term];
  const minimum = HANGUL_PATTERN.test(shorter) ? 2 : 4;
  return shorter.length >= minimum && longer.startsWith(shorter);
}

/** How many distinct query terms a paper's own text mentions. */
export function literatureTermMatchCount(text: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const words = [...new Set(splitWords(text).map(withoutKoreanParticle))];
  return terms.filter((term) => words.some((word) => sharesStem(term, word))).length;
}

/** A specific query must be mentioned twice; a short one once; an empty one cannot be checked. */
export function requiredLiteratureTermMatches(termCount: number): number {
  if (termCount <= 0) return 0;
  return termCount >= 4 ? 2 : 1;
}

/** True when the text is a sentence or a request rather than provider-ready keywords. */
export function literatureQueryNeedsPlanning(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (NON_LATIN_LETTER_PATTERN.test(trimmed)) return true;
  if (trimmed.includes('?') || REQUEST_OPENING_PATTERN.test(trimmed)) return true;
  return trimmed.split(/\s+/u).length >= 9;
}
