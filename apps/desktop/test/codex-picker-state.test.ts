import { describe, expect, it } from 'vitest';

import { resetCodexPicker, selectCodexModel } from '../src/renderer/src/codex-picker-state';

describe('Codex picker state', () => {
  it('preserves an opaque reasoning ID so an unsupported new model fails visibly', () => {
    expect(selectCodexModel('auto', 'future-ultra')).toEqual({
      modelId: 'auto',
      reasoningOptionId: 'future-ultra',
    });
  });

  it('returns both selectors to provider defaults after logout', () => {
    expect(resetCodexPicker()).toEqual({
      modelId: null,
      reasoningOptionId: null,
    });
  });
});
