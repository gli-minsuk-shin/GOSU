import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { SharedPaperSummaryLibrary } from './paper-summary-library';
import { paperSummaryCandidate, paperSaveReply } from './src/paper-summary-contract';
const answer =
  '## 연구 질문\n검증용 논문의 방법을 확인합니다.\n## 강점\n명시한 가정을 구분합니다.\n## 약점과 한계\n실제 실험은 제시하지 않습니다.';
it('offers after paper analysis but never treats source text as confirmation', () => {
  expect(paperSummaryCandidate('이 논문 분석해줘', answer)).toBeNull();
  expect(
    paperSummaryCandidate('"Briefing Lab 논문 요약"에 없는데?', '보관함에 추가할까요?'),
  ).toBeNull();
  expect(paperSummaryCandidate('오늘 일정 알려줘', '회의는 오전 10시부터입니다.')).toBeNull();
  expect(paperSaveReply('넣어줘')).toBe('save');
  expect(paperSaveReply('저장하지 마')).toBe('decline');
  expect(paperSaveReply('네', false)).toBeNull();
  expect(paperSaveReply('논문 요약 보관함에 추가해줘', false)).toBe('save');
  expect(paperSaveReply('메일에 "저장해줘"라고 써 있어')).toBeNull();
  const cited = paperSummaryCandidate(
    '그 가정이 필요한 이유는?',
    'Bayesian paper의 가정은 추정의 식별을 위해 필요합니다.',
    [{ title: 'Bayesian paper', url: 'https://doi.org/10.1000/bayesian.paper' }],
  );
  expect(cited?.title).toBe('Bayesian paper');
  expect(cited?.sourceUrls).toEqual(['https://doi.org/10.1000/bayesian.paper']);
  // Ingestion only opens arXiv, DOI, OpenReview and PMLR links, so nothing else is offered.
  expect(
    paperSummaryCandidate(
      '그 가정이 필요한 이유는?',
      'Bayesian paper의 가정은 추정의 식별을 위해 필요합니다.',
      [{ title: 'Bayesian paper', url: 'https://example.org/paper' }],
    ),
  ).toBeNull();
});
it('requires explicit approval, encrypts exact content and survives restart without duplicate writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-library-test-'));
  const key = vi.fn(async () => Buffer.alloc(32, 9));
  try {
    // Storage-only fixture: ingestion is independently source-verified in its regression suite.
    const prepare = async (candidate: NonNullable<ReturnType<typeof paperSummaryCandidate>>) => [
      candidate,
    ];
    const library = new SharedPaperSummaryLibrary(dir, key, prepare);
    const candidate = paperSummaryCandidate(
      'https://arxiv.org/abs/2609.00001v1 이 논문 분석해줘',
      answer,
    )!;
    await expect(library.save({ candidate, confirmed: false }, 'GOSU')).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
    await expect(
      library.save(
        { candidate, confirmed: true },
        'Briefing Lab',
        new AbortController().signal,
        async () => {
          throw new Error('assistant_settings_changed');
        },
      ),
    ).rejects.toThrow('settings_changed');
    expect(await library.list()).toHaveLength(0);
    const saved = await library.save({ candidate, confirmed: true }, 'GOSU');
    expect(saved.alreadySaved).toBe(false);
    const file = join(dir, 'approved-paper-summaries', saved.id + '.paper.enc.json');
    expect(await readFile(file, 'utf8')).not.toContain('연구 질문');
    const another = new SharedPaperSummaryLibrary(dir, key, prepare);
    expect((await another.list())[0]?.markdown).toBe(answer);
    expect((await another.save({ candidate, confirmed: true }, 'Briefing Lab')).alreadySaved).toBe(
      true,
    );
    expect(await another.list()).toHaveLength(1);
    const other = { ...candidate, markdown: candidate.markdown + '\n추가로 검증한 분석입니다.' };
    const concurrent = await Promise.all([
      library.save({ candidate: other, confirmed: true }, 'GOSU'),
      another.save({ candidate: other, confirmed: true }, 'Briefing Lab'),
    ]);
    expect(new Set(concurrent.map((r) => r.id)).size).toBe(1);
    expect(concurrent.filter((r) => !r.alreadySaved)).toHaveLength(1);
    expect(await another.list()).toHaveLength(2);
    await expect(
      another.save(
        { candidate: { ...candidate, sourceUrls: ['https://127.0.0.1/private'] }, confirmed: true },
        'GOSU',
      ),
    ).rejects.toThrow('source_invalid');
    expect(await another.list()).toHaveLength(2);
    await expect(another.remove(['../escape'])).rejects.toThrow();
    await another.remove([saved.id]);
    expect((await another.list()).map((p) => p.id)).not.toContain(saved.id);
    expect(await readFile(file + '.trash', 'utf8')).not.toContain('연구 질문');
    expect(await new SharedPaperSummaryLibrary(dir, key, prepare).list()).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
