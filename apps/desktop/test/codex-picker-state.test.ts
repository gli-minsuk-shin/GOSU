import { describe, expect, it } from 'vitest';

import { resetCodexPicker, selectCodexModel } from '../src/renderer/src/codex-picker-state';

describe('Codex picker state', () => {
  it('clears reasoning when a model changes without reserving an opaque model ID', () => {
    expect(selectCodexModel('auto')).toEqual({
      modelId: 'auto',
      reasoningOptionId: null,
    });
  });

  it('returns both selectors to provider defaults after logout', () => {
    expect(resetCodexPicker()).toEqual({
      modelId: null,
      reasoningOptionId: null,
    });
  });
});
