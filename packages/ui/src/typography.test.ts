import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseTypographyMessage,
  typographyMessage,
  UI_TEXT_SIZE_BASE_PX,
  UI_TEXT_SIZES,
} from './typography';

describe('Shared readable UI typography', () => {
  it.each(UI_TEXT_SIZES)('has a bounded presentation message for %s', (size) => {
    expect(parseTypographyMessage(typographyMessage(size))).toEqual({
      type: 'gosu:ui-typography',
      version: 1,
      textSize: size,
    });
  });
  it.each([
    null,
    [],
    { type: 'gosu:ui-typography', version: 1, textSize: '100px' },
    { type: 'gosu:ui-typography', version: 1, textSize: 'large', css: 'untrusted' },
    { type: 'gosu:ui-typography', version: 2, textSize: 'default' },
  ])('rejects malformed or arbitrary styles', (message) => {
    expect(parseTypographyMessage(message)).toBeNull();
  });
  it('keeps CSS roles, readability floors, and the displayed preset sizes aligned', () => {
    const css = readFileSync(new URL('./typography.css', import.meta.url), 'utf8');
    expect(UI_TEXT_SIZE_BASE_PX).toEqual({
      compact: 10,
      default: 12,
      large: 14,
      'extra-large': 16,
    });
    expect(css).toContain('--font-body: calc(12px + var(--font-adjustment))');
    expect(css).toContain('--font-caption: max(9px, calc(11px + var(--font-adjustment)))');
    expect(css).toContain('--font-title: calc(18px + var(--font-adjustment))');
    expect(css).toContain('--font-display: calc(22px + var(--font-adjustment))');
    expect(css).toContain('--font-meta: max(9px, calc(11px + var(--font-adjustment)))');
    expect(css).toContain('--font-control: var(--font-body)');
    for (const role of ['heading', 'title', 'display', 'kicker', 'code'])
      expect(css).toContain(`--font-${role}:`);
    for (const [index, size] of UI_TEXT_SIZES.entries()) {
      expect(css).toMatch(
        new RegExp(`data-text-size='${size}'[^}]+--font-adjustment:\\s*${index * 2 - 2}px`),
      );
    }
  });
});
