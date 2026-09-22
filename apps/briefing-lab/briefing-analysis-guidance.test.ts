import { describe, expect, it, vi } from 'vitest';
import { analyzeBriefing } from './briefing-analysis';
import type { LiveItem } from './src/live-types';

const mail = (id: string, sender: string): LiveItem => ({
  id,
  kind: 'email',
  title: `Subject ${id}`,
  text: `Body of ${id}.`,
  source: 'Synthetic',
  readScope: 'mail-preview',
  details: [sender, '읽지 않음'],
});
const emailAnswer = (ids: string[]) => ({
  answer: JSON.stringify({
    overview: 'Overview',
    items: ids.map((id) => ({
      id,
      summary: `Summary ${id}.`,
      importance: 'high',
      importanceReason: 'Reason',
      action: '',
      evidenceQuote: `Body of ${id}.`,
      memorySuggestion: null,
      preparedActions: { event: null, task: null },
    })),
  }),
  proposal: null,
  nextDates: [],
  providerId: 'claude-code',
  model: 'haiku',
  reasoning: 'off',
});
const request = (itemIds: string[]) => ({
  routineId: 'r',
  receiptId: '11111111-1111-4111-8111-111111111111',
  itemIds,
  providerId: 'claude-code' as const,
  modelId: 'claude-code:haiku',
  reasoning: 'off',
  includeMail: true,
  memory: [],
});
const guidance = [
  { id: 'g1', text: 'kim.prof@yonsei.ac.kr 메일은 반드시 요약에 포함' },
  { id: 'g2', text: '학회 광고는 낮은 중요도로' },
];
type Job = { structuredJob: { instructions: string; prompt: string } };
async function emailRun(withGuidance: boolean) {
  const run = vi.fn(async () => emailAnswer(['a', 'b']));
  await analyzeBriefing(
    request(['a', 'b']),
    [mail('a', '김교수 <Kim.Prof@yonsei.ac.kr>'), mail('b', 'Conference <ads@conf.example>')],
    { keywords: [], excluded: [] },
    new AbortController().signal,
    vi.fn(),
    run,
    undefined,
    undefined,
    [],
    'Asia/Seoul',
    withGuidance ? guidance : [],
  );
  const job = (run.mock.calls as unknown[][])[0]![3] as Job;
  return {
    instructions: job.structuredJob.instructions,
    prompt: JSON.parse(job.structuredJob.prompt),
  };
}

describe('user guidance in the summary prompts', () => {
  it('gives the email summary the guidance lines and marks mail from a listed address', async () => {
    const { instructions, prompt } = await emailRun(true);
    expect(prompt.userGuidance).toEqual(guidance.map((g) => g.text));
    expect(prompt.items[0].matchesUserGuidance).toBe(true);
    expect(prompt.items[1]).not.toHaveProperty('matchesUserGuidance');
    expect(instructions).toContain('USER GUIDANCE');
    // The guidance is the user's own instruction, but it never lifts the evidence rules.
    expect(instructions).toMatch(/never creates facts/i);
  });

  it('leaves the prompt and instructions exactly as before when there is no guidance', async () => {
    const { instructions, prompt } = await emailRun(false);
    expect(prompt).not.toHaveProperty('userGuidance');
    expect(prompt.items[0]).not.toHaveProperty('matchesUserGuidance');
    expect(instructions).not.toContain('USER GUIDANCE');
  });

  it('gives paper summaries the same guidance lines', async () => {
    const paper: LiveItem = {
      id: 'p',
      kind: 'papers',
      title: 'Paper p',
      text: 'An abstract about solvers.',
      source: 'arXiv',
      details: [],
      readScope: 'abstract',
    };
    const run = vi.fn(async () => ({
      ...emailAnswer([]),
      answer: JSON.stringify({
        overview: 'Overview',
        items: [
          {
            id: 'p',
            summary: 'Summary.',
            keywords: ['Solvers'],
            detail: 'Detail.',
            researchQuestion: 'Q?',
            strengths: 'S.',
            limitations: 'L.',
            methodsAndAssumptions: 'M.',
            reportedResults: 'R.',
            equationExplanations: [],
            importance: 'medium',
            importanceReason: 'Reason',
            relevance: 'Related',
            action: 'Read',
            evidenceQuote: 'An abstract about solvers.',
            equationIds: [],
            figureIds: [],
            memorySuggestion: null,
          },
        ],
      }),
    }));
    await analyzeBriefing(
      { ...request(['p']), includeMail: false },
      [paper],
      { keywords: [], excluded: [] },
      new AbortController().signal,
      vi.fn(),
      run,
      undefined,
      undefined,
      [],
      'Asia/Seoul',
      guidance,
    );
    const job = (run.mock.calls as unknown[][])[0]![3] as Job;
    expect(JSON.parse(job.structuredJob.prompt).userGuidance).toEqual(guidance.map((g) => g.text));
    expect(job.structuredJob.instructions).toContain('USER GUIDANCE');
  });
});

describe('sender preferences learned from ratings', () => {
  const profile = {
    total: 4,
    important: 2,
    notInterested: 2,
    kindScores: { papers: 0, email: 0 },
    preferredKeywords: [],
    avoidedKeywords: [],
    preferredSenders: [{ term: 'kim.prof@yonsei.ac.kr', score: 2 }],
    avoidedSenders: [{ term: 'promo@conf.example', score: -1 }],
    preferredSenderDomains: [{ term: 'nrf.re.kr', score: 1 }],
    avoidedSenderDomains: [],
  };
  async function run(feedback: typeof profile | undefined) {
    const run = vi.fn(async () => emailAnswer(['a', 'b', 'c', 'd']));
    await analyzeBriefing(
      request(['a', 'b', 'c', 'd']),
      [
        mail('a', '김교수 <Kim.Prof@yonsei.ac.kr>'),
        mail('b', 'Conference <promo@conf.example>'),
        mail('c', '한국연구재단 <noreply@mail.nrf.re.kr>'),
        mail('d', 'Someone <x@elsewhere.example>'),
      ],
      { keywords: [], excluded: [] },
      new AbortController().signal,
      vi.fn(),
      run,
      undefined,
      feedback,
      [],
      'Asia/Seoul',
    );
    const job = (run.mock.calls as unknown[][])[0]![3] as Job;
    return {
      instructions: job.structuredJob.instructions,
      prompt: JSON.parse(job.structuredJob.prompt),
    };
  }
  it('marks each email from a rated sender or institution and tells the model how to weigh it', async () => {
    const { instructions, prompt } = await run(profile);
    expect(prompt.items.map((i: { senderFeedback?: string }) => i.senderFeedback)).toEqual([
      'preferred',
      'avoided',
      'preferred',
      undefined,
    ]);
    expect(instructions).toContain('senderFeedback');
    expect(instructions).toMatch(/reply, deadline or decision/);
  });
  it('adds nothing when no sender was rated', async () => {
    const { instructions, prompt } = await run(undefined);
    expect(prompt.items.some((i: object) => 'senderFeedback' in i)).toBe(false);
    expect(instructions).not.toContain('senderFeedback');
  });
});
