import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('uses a full-width flex canvas and readable composer instead of the sidebar overlay', () => {
  const css = readFileSync(new URL('./global-assistant-chat.css', import.meta.url), 'utf8');
  expect(css).toContain('.briefing-app.is-global-assistant .briefing-workspace');
  expect(css).toContain('flex: 1 1 0');
  expect(css).toContain('max-width: none');
  expect(css).toContain('position: relative');
  expect(css).toContain('inset: auto');
  expect(css).toContain('min-height: 128px');
  expect(css).toContain('margin-left: auto');
  expect(css).toContain('line-height: 1.7');
  expect(css).toContain('repeat(2, minmax(0, 1fr))');
  expect(css).toContain('justify-content: flex-end');
  expect(css).toContain('max-height: min(340px, 45vh)');
});
it('balances chat and input at 13px and bounds answer heading sizes without shrinking the canvas', () => {
  const css = readFileSync(new URL('./global-assistant-chat.css', import.meta.url), 'utf8');
  const rule = (selector: string) => css.split(`${selector} {`)[1]!.split('}')[0]!;
  expect(rule('.briefing-app.is-global-assistant .briefing-chat')).toContain('font-size: 13px');
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-input-box textarea')).toContain(
    'font-size: 13px',
  );
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-input-box textarea')).toContain(
    'min-height: 128px',
  );
  expect(rule('.briefing-app.is-global-assistant .briefing-chat-welcome h3')).toContain(
    'font-size: 18px',
  );
  const shared = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
  expect(shared).toMatch(/\.briefing-chat-message-copy h1\s*\{\s*font-size: 1\.38em/);
  expect(shared).toMatch(/\.briefing-chat-message-copy h3\s*\{\s*font-size: 1\.08em/);
});
