import { describe, expect, it } from 'vitest';
import { initialWorkspace } from './fixtures';
import {
  materializeProposal,
  proposalPreview,
  RoutineRequestSchema,
  RoutineProposalSchema,
  type RoutineProposal,
} from './routine-builder';

export function exampleProposal(): RoutineProposal {
  const routine = initialWorkspace('2026-09-08T01:00:00.000Z').routines[0]!;
  return RoutineProposalSchema.parse({
    name: 'AI 연구 아침',
    kind: 'personal',
    schedule: routine.schedule,
    interest: routine.interest,
    sourceIds: [],
    countries: ['KR'],
  });
}
describe('LLM routine proposals', () => {
  it('creates only a validated draft without sample sources or live permissions', () => {
    const result = materializeProposal(exampleProposal(), 'host-id', '2026-09-08T01:00:00.000Z');
    expect(result.id).toBe('host-id');
    expect(result.state).toBe('draft');
    expect(result.sources).toEqual([]);
    expect(result.live).toBeUndefined();
    expect(proposalPreview(exampleProposal(), result.createdAt)).toHaveLength(5);
  });
  it.each([
    { state: 'enabled' },
    { id: 'overwrite-existing' },
    { command: 'osascript' },
    { sourceIds: ['https://example.com'] },
    { sourceIds: ['sample-papers'] },
    { sourceIds: ['sample-papers', 'sample-papers'] },
    { sourceIds: ['sample-funding-kr'] },
    { schedule: { ...exampleProposal().schedule, timeZone: 'Bad/Timezone' } },
    { schedule: { ...exampleProposal().schedule, times: ['25:99'] } },
    { schedule: { ...exampleProposal().schedule, anchorDate: '2026-02-30' } },
    { schedule: { ...exampleProposal().schedule, frequency: 'weekly', weekdays: [] } },
  ])('rejects invalid or authority-expanding proposal %j', (patch) => {
    expect(() =>
      materializeProposal({ ...exampleProposal(), ...patch }, 'id', '2026-09-08T00:00:00.000Z'),
    ).toThrow();
  });
  it('bounds conversation and rejects unsupported engines', () => {
    const request = {
      prompt: 'Every two weeks',
      providerId: 'codex',
      modelId: 'live-model',
      reasoning: null,
      history: [],
      previousProposal: null,
    };
    expect(RoutineRequestSchema.safeParse(request).success).toBe(true);
    expect(RoutineRequestSchema.safeParse({ ...request, providerId: 'api-key' }).success).toBe(
      false,
    );
    expect(RoutineRequestSchema.safeParse({ ...request, prompt: 'a'.repeat(6001) }).success).toBe(
      false,
    );
    expect(
      RoutineRequestSchema.safeParse({
        ...request,
        history: Array(7).fill({ role: 'user', text: 'hello' }),
      }).success,
    ).toBe(false);
  });
});
