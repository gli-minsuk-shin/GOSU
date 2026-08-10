import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CollapseChevron } from '../src/renderer/src/ui-primitives';

describe('CollapseChevron', () => {
  it('renders every panel direction with the shared accessible presentation boundary', () => {
    const markup = (['up', 'down', 'left', 'right'] as const).map((direction) =>
      renderToStaticMarkup(<CollapseChevron direction={direction} />),
    );

    expect(new Set(markup).size).toBe(4);
    for (const html of markup) {
      expect(html).toContain('class="collapse-chevron"');
      expect(html).toContain('viewBox="0 0 20 20"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('focusable="false"');
      expect(html).toContain('<path d="');
    }
  });
});
