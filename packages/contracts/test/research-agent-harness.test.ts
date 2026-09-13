import { describe, expect, it } from 'vitest';

import {
  assembleResearchAgentInstructions,
  GOSU_RESEARCH_AGENT_POLICY,
} from '../src/research-agent-harness.js';

describe('shared research agent harness instructions', () => {
  it('requires a post-analysis paper-library offer while keeping consent and batch boundaries', () => {
    const prompt = assembleResearchAgentInstructions([]);
    expect(prompt).toContain('always ask whether to add that analysis');
    expect(prompt).toContain('never an automatic write');
    expect(prompt).toContain('without a host save receipt');
    expect(prompt).toContain('not automatically archived briefing batches');
  });
  it('uses exactly the same stable behavior prefix for both application domains', () => {
    const prefix = assembleResearchAgentInstructions([]);
    const desktop = assembleResearchAgentInstructions('Project Chat: respect Apply approvals.');
    const modelLab = assembleResearchAgentInstructions([
      'Model Lab: proposed edits require a new immutable revision.',
      'Source imports must be validated before creating a graph.',
    ]);

    expect(prefix).toContain(GOSU_RESEARCH_AGENT_POLICY.id);
    expect(prefix).toContain(`v${GOSU_RESEARCH_AGENT_POLICY.version}`);
    expect(desktop.startsWith(`${prefix}\n\n`)).toBe(true);
    expect(modelLab.startsWith(`${prefix}\n\n`)).toBe(true);
    expect(desktop.split(GOSU_RESEARCH_AGENT_POLICY.content)).toHaveLength(2);
    expect(modelLab.split(GOSU_RESEARCH_AGENT_POLICY.content)).toHaveLength(2);
    expect(desktop).not.toContain('Model Lab:');
    expect(modelLab).not.toContain('Project Chat:');
    expect(modelLab).toMatch(/immutable revision\.\n\nSource imports/);
  });

  it('normalizes empty application sections without mutating the caller input or user text', () => {
    const sections = Object.freeze(['  Domain rules.  ', '', ' \n ', 'A second rule.']);

    expect(assembleResearchAgentInstructions(sections)).toBe(
      assembleResearchAgentInstructions(['Domain rules.', 'A second rule.']),
    );
    expect(assembleResearchAgentInstructions('Domain rules.')).toBe(
      assembleResearchAgentInstructions(['Domain rules.']),
    );
    expect(assembleResearchAgentInstructions(' \n ')).toBe(assembleResearchAgentInstructions([]));
    expect(sections).toEqual(['  Domain rules.  ', '', ' \n ', 'A second rule.']);
  });
});
