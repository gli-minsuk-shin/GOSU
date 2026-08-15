import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  OverleafPersonalTokenDialog,
  resolveOverleafTokenReturnFocus,
} from '../src/renderer/src/overleaf-personal-token-dialog';
import {
  describeOverleafPersonalTokenError,
  OVERLEAF_PERSONAL_TOKEN_CLEAR_CONFIRMATION,
} from '../src/renderer/src/overleaf-personal-token-ui';

describe('Overleaf personal token settings', () => {
  it('opens above the current workspace without navigating away from a Lecture draft', () => {
    const html = renderToStaticMarkup(
      <OverleafPersonalTokenDialog
        state="not_configured"
        onRefresh={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const desktopSource = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    const dialogSource = readFileSync(
      new URL('../src/renderer/src/overleaf-personal-token-dialog.tsx', import.meta.url),
      'utf8',
    );
    const openHandler = desktopSource.match(
      /const openOverleafSettings = \(\) => \{(?<body>[\s\S]*?)\n\s{2}\};/u,
    )?.groups?.body;

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('current Manuscript or Lecture draft stays open');
    expect(openHandler).toContain('setOverleafTokenSettingsOpen(true)');
    expect(openHandler).not.toContain('setActiveSurface');
    expect(dialogSource).toContain('resolveOverleafTokenReturnFocus');
    expect(dialogSource).toContain('[data-overleaf-token-focus-fallback]');
    expect(dialogSource).toContain('disabled={operationPending}');
    expect(dialogSource).toContain('if (!operationPending) onClose()');
  });

  it('returns focus to the new URL field when saving replaces the opener', () => {
    const opener = { isConnected: false } as HTMLElement;
    const fallback = { isConnected: true } as HTMLElement;

    expect(resolveOverleafTokenReturnFocus(opener, fallback)).toBe(fallback);
    expect(
      resolveOverleafTokenReturnFocus({ isConnected: true } as HTMLElement, fallback),
    ).not.toBe(fallback);
    expect(
      resolveOverleafTokenReturnFocus(opener, { isConnected: false } as HTMLElement),
    ).toBeNull();
  });

  it('uses safe non-secret error copy and explains clear semantics', () => {
    expect(describeOverleafPersonalTokenError(new Error('overleaf_token_invalid: hidden'))).toBe(
      'Enter a valid Overleaf personal Git token without spaces.',
    );
    expect(describeOverleafPersonalTokenError(new Error('unknown: secret-value'))).not.toContain(
      'secret-value',
    );
    expect(OVERLEAF_PERSONAL_TOKEN_CLEAR_CONFIRMATION).toContain(
      'Existing linked manuscripts keep working',
    );
    expect(OVERLEAF_PERSONAL_TOKEN_CLEAR_CONFIRMATION).toContain(
      'does not revoke the token in Overleaf',
    );
  });
});
