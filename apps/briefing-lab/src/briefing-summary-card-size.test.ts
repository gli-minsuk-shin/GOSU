import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
const rule = (selector: string) =>
  css
    .split(`${selector} {`)
    .slice(1)
    .map((part) => part.split('}')[0])
    .join(' ');

it('gives every "먼저 확인할 내용" card the same size', () => {
  // Cards used to take their own content height (align-items: start), so mail, paper and agenda
  // boxes ended at different heights; every row now takes the tallest card's height.
  const grid = rule('.briefing-assistant-highlights');
  expect(grid).toContain('grid-auto-rows: 1fr');
  expect(grid).toContain('align-items: stretch');
  expect(grid).not.toContain('align-items: start');
});

it('keeps the cards wide and low instead of nearly square', () => {
  // At a 960px summary the cards were 221×185 (almost square): narrow columns split the mail
  // sender, account and time over two lines, and the jump hint took its own bottom line.
  expect(rule('.briefing-assistant-highlights')).toContain(
    'grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
  );
  // The jump hint shares the first row with the kind label, in its own column so it never overlaps.
  expect(rule('.briefing-assistant-highlight')).toContain(
    'grid-template-columns: minmax(0, 1fr) auto',
  );
  const hint = rule('.briefing-assistant-highlight > .briefing-summary-jump-hint');
  expect(hint).toContain('grid-row: 1');
  expect(hint).toContain('grid-column: 2');
  // Sender, receiving account and time stay on one line, cut with an ellipsis.
  expect(rule('.briefing-assistant-highlight > .briefing-mail-delivery')).toContain(
    'flex-wrap: nowrap',
  );
  expect(rule('.briefing-assistant-highlight .briefing-mail-account')).toContain(
    'text-overflow: ellipsis',
  );
});
