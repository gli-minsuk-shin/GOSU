import { describe, expect, it } from 'vitest';

import {
  resolveActiveProjectId,
  trashedProjects,
  visibleProjects,
} from '../src/renderer/src/project-portfolio-model';
import type { ProjectRecord } from '../src/shared/workspace-contracts';

const active: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Active',
  slug: 'active',
  version: 1,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};
const trashed: ProjectRecord = {
  ...active,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Trashed',
  slug: 'trashed',
  trashedAt: '2026-08-04T01:00:00.000Z',
  version: 2,
};

describe('project portfolio visibility', () => {
  it('partitions active and recoverable projects', () => {
    expect(visibleProjects([trashed, active])).toEqual([active]);
    expect(trashedProjects([trashed, active])).toEqual([trashed]);
  });

  it('preserves a visible selection and falls back when the current project is trashed', () => {
    expect(resolveActiveProjectId([active, trashed], active.id)).toBe(active.id);
    expect(resolveActiveProjectId([active, trashed], trashed.id)).toBe(active.id);
    expect(resolveActiveProjectId([trashed], trashed.id)).toBe('');
  });
});
