import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SearchView, shouldAcceptSearchResponse } from '../src/renderer/src/search-view';

describe('SearchView', () => {
  it('renders a local-only global search form without querying during render', () => {
    let searches = 0;
    const html = renderToStaticMarkup(
      <SearchView
        adapter={{
          search: async () => {
            searches += 1;
            throw new Error('unexpected');
          },
        }}
        scope={{ kind: 'global' }}
        scopeLabel="all projects"
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain('Search all projects');
    expect(html).toContain('Content stays on this Mac');
    expect(searches).toBe(0);
  });

  it('uses compact copy inside Research Notes', () => {
    const html = renderToStaticMarkup(
      <SearchView
        adapter={{ search: async () => Promise.reject(new Error('not called')) }}
        scope={{ kind: 'project', projectId: '00000000-0000-4000-8000-000000000001' }}
        scopeLabel="Research Notes"
        compact
        onOpen={() => undefined}
      />,
    );
    expect(html).toContain('Search Research Notes');
    expect(html).not.toContain('<h1>Search</h1>');
  });

  it('rejects a stale result after the search scope or request generation changes', () => {
    expect(shouldAcceptSearchResponse(4, 4, 'project:b', 'project:a')).toBe(false);
    expect(shouldAcceptSearchResponse(5, 4, 'project:a', 'project:a')).toBe(false);
    expect(shouldAcceptSearchResponse(4, 4, 'project:a', 'project:a')).toBe(true);
  });
});
