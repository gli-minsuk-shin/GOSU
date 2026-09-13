import { describe, expect, it } from 'vitest';
import { typographyMessage, UI_TEXT_SIZES } from '@gosu/ui/typography';
import { applyEmbeddedTypography } from './model-lab-typography';

describe('Embedded Model Lab typography', () => {
  it.each(UI_TEXT_SIZES)('applies %s without replacing a document or model', (size) => {
    const parent = {} as Window;
    const root = { dataset: { textSize: 'default', projectId: 'unchanged' } };
    expect(
      applyEmbeddedTypography(
        { source: parent, origin: 'null', data: typographyMessage(size) },
        parent,
        root,
      ),
    ).toBe(true);
    expect(root.dataset).toEqual({ textSize: size, projectId: 'unchanged' });
  });
  it('ignores unrelated origins, frames, and arbitrary style payloads', () => {
    const parent = {} as Window;
    const root = { dataset: { textSize: 'compact' } };
    for (const event of [
      { source: parent, origin: 'https://example.com', data: typographyMessage('large') },
      { source: {} as Window, origin: 'null', data: typographyMessage('large') },
      { source: parent, origin: 'null', data: { ...typographyMessage('large'), css: 'injected' } },
      {
        source: parent,
        origin: 'null',
        data: { ...typographyMessage('large'), textSize: '400px' },
      },
    ])
      expect(applyEmbeddedTypography(event, parent, root)).toBe(false);
    expect(root.dataset.textSize).toBe('compact');
  });
});
