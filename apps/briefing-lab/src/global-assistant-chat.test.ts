import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('uses a full-width flex canvas and readable composer instead of the sidebar overlay', () => {
  const css = readFileSync(new URL('./global-assistant-chat.css', import.meta.url), 'utf8');
  expect(css).toContain('.briefing-app.is-global-assistant .briefing-workspace');
  expect(css).toContain('flex: 1 1 0');
  expect(css).toContain('max-width: none');
  expect(css).toContain('position: relative');
  expect(css).toContain('inset: auto');
  expect(css).toContain('min-height: 80px');
  expect(css).toContain('margin-left: auto');
  expect(css).toContain('line-height: 1.7');
  expect(css).toContain('repeat(2, minmax(0, 1fr))');
  expect(css).toContain('.briefing-app.is-global-assistant .briefing-chat-input-toolbar {');
  expect(css).toContain('max-height: min(340px, 45vh)');
});
it('keeps the composer close to the latest answer without stacked empty space', () => {
  const css = readFileSync(new URL('./global-assistant-chat.css', import.meta.url), 'utf8');
  const rule = (selector: string) => css.split(`${selector} {`)[1]!.split('}')[0]!;
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-log')).toContain(
    'padding: 20px 24px 8px',
  );
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-message:last-child')).toContain(
    'margin-bottom: 0',
  );
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-status')).toContain(
    'padding: 2px 24px 0',
  );
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-composer')).toContain(
    'padding: 4px 24px 14px',
  );
  // The context meter is a chip beside the send button, and both sit in the input box's own
  // toolbar row (0.58.133) instead of a second row under the box. This input box clips its content
  // (`overflow: hidden` for its rounded corners), so the meter's details must not be positioned
  // against it: they open in the top layer (0.58.139, see context-usage-meter.test.tsx).
  const shared = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  expect(shared).toMatch(
    /\.briefing-chat-input-toolbar > \.briefing-chat-composer-actions \{[^}]*margin: 0 0 0 auto;/u,
  );
  expect(shared).toMatch(/\.briefing-chat-input-box textarea \{[^}]*field-sizing: content;/u);
  expect(shared).not.toContain('min-height: 96px');
  const meter = readFileSync(new URL('./context-usage-meter.css', import.meta.url), 'utf8');
  const detail = meter.split('.briefing-context-detail {')[1]!.split('}')[0]!;
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-input-box')).toContain(
    'overflow: hidden',
  );
  expect(detail).toContain('position: fixed');
  expect(detail).not.toContain('position: absolute');
  // The readable typing area is not shrunk to win the space back: 80px of text where the old
  // 128px field gave 64px above its overlaid icons.
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-input-box textarea')).toContain(
    'min-height: 80px',
  );
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-input-box textarea')).toContain(
    'padding: 14px 18px 4px',
  );
});
it('balances chat and input at 13px and bounds answer heading sizes without shrinking the canvas', () => {
  const css = readFileSync(new URL('./global-assistant-chat.css', import.meta.url), 'utf8');
  const rule = (selector: string) => css.split(`${selector} {`)[1]!.split('}')[0]!;
  expect(rule('.briefing-app.is-global-assistant .briefing-chat')).toContain('font-size: 13px');
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-input-box textarea')).toContain(
    'font-size: 13px',
  );
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-input-box textarea')).toContain(
    'min-height: 80px',
  );
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-welcome h3')).toContain(
    'font-size: 18px',
  );
  const shared = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  expect(shared).toMatch(/\.briefing-chat-message-copy h1\s*\{\s*font-size: 1\.38em/);
  expect(shared).toMatch(/\.briefing-chat-message-copy h3\s*\{\s*font-size: 1\.08em/);
});
