import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CollapseChevron, describeError } from '../src/renderer/src/ui-primitives';

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

describe('describeError', () => {
  it('explains BYO Hermes setup failures without exposing technical output', () => {
    expect(describeError(new Error('hermes_installation_not_supported:/Users/private'))).toBe(
      'GOSU could not find a standard local Hermes installation. Install Hermes with its standard installer, then try again.',
    );
    expect(describeError(new Error('hermes_runtime_check_failed:secret stderr'))).toBe(
      'GOSU could not safely verify this Hermes setup. Check its model configuration and sign-in, then try again.',
    );
    expect(
      describeError(new Error('hermes_version_unsupported_adapter_update_required:0.20.0')),
    ).toContain('Hermes 0.19.1 only');
    expect(describeError(new Error('hermes_runtime_provider_not_allowed:moa'))).toContain(
      'cannot use MoA or a provider that starts another agent',
    );
  });
});
