import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ExperimentsView, type ExperimentsViewAdapter } from '../src/renderer/src/experiments-view';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const project: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Trajectory Lab',
  slug: 'trajectory-lab',
  version: 1,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const adapter: ExperimentsViewAdapter = {
  list: vi.fn(),
  createIdea: vi.fn(),
  updateIdea: vi.fn(),
  recordMetric: vi.fn(),
  onEvent: vi.fn(() => () => undefined),
};

describe('ExperimentsView', () => {
  it('labels local immediacy and missing Runner streaming truthfully', () => {
    const html = renderToStaticMarkup(
      <ExperimentsView
        project={project}
        objective={undefined}
        adapter={adapter}
        onOpenObjective={vi.fn()}
      />,
    );

    expect(html).toContain('Local live');
    expect(html).toContain('Runner not connected');
    expect(html).toContain('Define Goal &amp; Metrics first');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Trajectory');
    expect(html).toContain('Idea map');
    expect(html).toContain('Report');
    expect(html).not.toContain('83.6');
    expect(html).not.toContain('Demo');
  });

  it('keeps charts, graphs, tables, and report responsive and reduced-motion safe', () => {
    const styles = readFileSync(
      new URL('../src/renderer/src/experiments-view.css', import.meta.url),
      'utf8',
    );

    expect(styles).toMatch(/\.experiment-table-scroll\s*\{[^}]*overflow:\s*auto;/su);
    expect(styles).toMatch(/\.experiment-graph-scroll\s*\{[^}]*overflow:\s*auto;/su);
    expect(styles).toMatch(/@media \(max-width: 1180px\)[\s\S]*?grid-template-columns:\s*1fr;/u);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)/u);
    expect(styles).toMatch(/@media print/u);
  });
});
