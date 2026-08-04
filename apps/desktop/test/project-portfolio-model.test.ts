import { describe, expect, it } from 'vitest';

import {
  activeProjects,
  archivedProjects,
  resolveActiveProjectId,
  sidebarProjects,
  trashedProjects,
  visibleProjects,
} from '../src/renderer/src/project-portfolio-model';
import type { PortfolioProjectRecord } from '../src/renderer/src/project-portfolio-model';

const active: PortfolioProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Active',
  slug: 'active',
  version: 1,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};
const trashed: PortfolioProjectRecord = {
  ...active,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Trashed',
  slug: 'trashed',
  trashedAt: '2026-08-04T01:00:00.000Z',
  version: 2,
};
const archived: PortfolioProjectRecord = {
  ...active,
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Archived',
  slug: 'archived',
  archivedAt: '2026-08-04T02:00:00.000Z',
  version: 2,
};

describe('project portfolio visibility', () => {
  it('partitions active and recoverable projects', () => {
    expect(activeProjects([trashed, archived, active])).toEqual([active]);
    expect(visibleProjects([trashed, archived, active])).toEqual([active]);
    expect(archivedProjects([trashed, archived, active])).toEqual([archived]);
    expect(trashedProjects([trashed, archived, active])).toEqual([trashed]);
  });

  it('preserves a visible selection and falls back when the current project is unavailable', () => {
    expect(resolveActiveProjectId([active, archived, trashed], active.id)).toBe(active.id);
    expect(resolveActiveProjectId([active, archived, trashed], trashed.id)).toBe(active.id);
    expect(resolveActiveProjectId([active, archived, trashed], archived.id)).toBe(active.id);
    expect(resolveActiveProjectId([archived, trashed], trashed.id)).toBe('');
  });

  it('excludes locally hidden projects from the sidebar and active fallback', () => {
    const second = {
      ...active,
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Second',
      slug: 'second',
    };
    const hidden = new Set([active.id]);

    expect(sidebarProjects([active, second, archived], hidden)).toEqual([second]);
    expect(resolveActiveProjectId([active, second, archived], active.id, hidden)).toBe(second.id);
    expect(resolveActiveProjectId([active], active.id, hidden)).toBe('');
  });
});
