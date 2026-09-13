import type { BriefingHistory } from '../briefing-workspace-store';
import { BriefingMarkdown } from './briefing-insight-card';
import './briefing-narrative.css';

type Item = BriefingHistory['items'][number];
const generic = new Set(
  'The This That Your You Our New From With About For And Important Please Invitation Meeting Research Data Model Models Paper Conference Update Updates'.split(
    ' ',
  ),
);
/** Literal presentation hints from this summary's own sources; never rewrite or re-summarize it. */
export function narrativeHints(
  text: string,
  items: readonly Item[],
  agendaTitles: readonly string[] = [],
) {
  const titles = [...items.map((i) => i.title), ...agendaTitles].filter(
    (t) => t.trim().length > 2 && text.includes(t),
  );
  const prose = text.replace(/https?:\/\/\S+/g, '');
  const dates = [
    ...prose.matchAll(
      /(?:20\d{2}-\d{2}-\d{2}|\d{1,2}월\s*\d{1,2}(?:\s*[~–-]\s*\d{1,2})?일)(?:\s*\([월화수목금토일]\))?(?:\s*(?:오전|오후)?\s*\d{1,2}:\d{2})?(?:\s*(?:까지|이전|전에|마감))?/g,
    ),
  ].map((m) => m[0]);
  const selected = items.flatMap((i) =>
    [...`${i.summary}\n${i.action ?? ''}`.matchAll(/\*\*([^*\n]{2,60})\*\*/g)].map((m) => m[1]!),
  );
  const keywords = items.flatMap((i) => i.keywords ?? []);
  const entities = items
    .flatMap((i) => [...i.title.matchAll(/\b[A-Z][A-Za-z0-9-]{2,24}\b/g)].map((m) => m[0]))
    .filter((t) => !generic.has(t));
  return {
    titles: [...new Set(titles)],
    keywords: [...new Set([...dates, ...selected, ...keywords, ...entities])]
      .filter(
        (t) =>
          t.length >= 3 &&
          t.length <= 60 &&
          prose.includes(t) &&
          !titles.some((title) => title.includes(t)),
      )
      .slice(0, 6),
  };
}
export function BriefingNarrative({
  text,
  items,
  agendaTitles = [],
}: {
  text: string;
  items: readonly Item[];
  agendaTitles?: readonly string[];
}) {
  const hints = narrativeHints(text, items, agendaTitles);
  return (
    <div className="briefing-narrative-entry">
      <BriefingMarkdown text={text} emphasizedTitles={hints.titles} keywords={hints.keywords} />
    </div>
  );
}
