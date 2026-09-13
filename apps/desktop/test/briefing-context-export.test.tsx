import { describe, it, expect } from 'vitest';
import { projectBriefingContext } from '../src/renderer/src/briefing-context-export';
import { BriefingProjectContextSchema } from '../../briefing-lab/src/briefing-intelligence';
describe('reviewed project memory export for Briefing', () => {
  it('exports only the selected reviewed summary, never raw chat or another project', () => {
    const project = { id: 'p', name: 'Study' };
    const snapshot = { schemaVersion: 1 as const, projectId: 'p', messages: [] };
    const result = projectBriefingContext(
      project,
      snapshot,
      'Reviewed optimization context',
      '2026-09-09T00:00:00Z',
    );
    expect(BriefingProjectContextSchema.safeParse(result).success).toBe(true);
    expect(result).not.toHaveProperty('messages');
    expect(() =>
      projectBriefingContext(project, { ...snapshot, projectId: 'other' }, 'context'),
    ).toThrow();
    expect(() => projectBriefingContext(project, snapshot, 'x'.repeat(3501))).toThrow();
  });
});
