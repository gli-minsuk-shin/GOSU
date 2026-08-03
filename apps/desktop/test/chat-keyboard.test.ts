import { describe, expect, it } from 'vitest';

import { shouldSendChatMessage } from '../src/renderer/src/chat-keyboard';

describe('Project Chat keyboard behavior', () => {
  it('sends on a plain Enter key', () => {
    expect(shouldSendChatMessage({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true);
  });

  it('keeps Shift+Enter available for a newline', () => {
    expect(shouldSendChatMessage({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false);
  });

  it('does not send while an IME composition is being confirmed', () => {
    expect(shouldSendChatMessage({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    expect(
      shouldSendChatMessage({
        key: 'Enter',
        shiftKey: false,
        isComposing: false,
        keyCode: 229,
      }),
    ).toBe(false);
  });

  it('ignores non-Enter keys', () => {
    expect(shouldSendChatMessage({ key: 'a', shiftKey: false, isComposing: false })).toBe(false);
  });
});
