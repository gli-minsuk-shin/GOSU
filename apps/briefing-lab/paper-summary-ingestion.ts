import { randomUUID, createHash } from 'node:crypto';
import { defaultLiveSettings } from '@gosu/briefing-core';
import type { ModelRouting } from '@gosu/contracts';
import { publicSourceText } from './live-public-http';
import { parseArxiv } from './live-public-sources';
import { enrichPaper, loadPaperFigure } from './briefing-paper-evidence';
import { analyzeBriefing } from './briefing-analysis';
import { assistantModel } from './briefing-assistant';
import { routedBriefingPreferences } from './briefing-model-routing';
import { BriefingWorkspaceStore } from './briefing-workspace-store';
import { PAPER_TEMPLATE_FIELDS } from './src/briefing-intelligence';
import type { PaperSummaryCandidate, PaperSummaryRecord } from './src/paper-summary-contract';
import type { LiveItem } from './src/live-types';

export type PreparedPaper = PaperSummaryCandidate & Pick<PaperSummaryRecord, 'paper'>;
export function arxivSaveId(value: string) {
  return (
    value.match(
      /^https:\/\/(?:www\.)?arxiv\.org\/(?:abs|html|pdf)\/((?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})(?:v\d+)?)(?:\.pdf)?(?:[?#].*)?$/,
    )?.[1] ?? null
  );
}
export async function preparePaperSummaries(
  candidate: PaperSummaryCandidate,
  existing: PaperSummaryRecord[],
  routing?: () => Promise<ModelRouting>,
  outerSignal?: AbortSignal,
): Promise<PreparedPaper[]> {
  const urls = [...new Set(candidate.sourceUrls)];
  if (
    !urls.length ||
    urls.some(
      (url) =>
        !arxivSaveId(url) &&
        !/^https:\/\/(?:doi\.org\/10\.\d{4,9}\/[^\s?#]+|proceedings\.mlr\.press\/v\d+\/[\w-]+\.html|openreview\.net\/forum\?id=[\w-]+)$/.test(
          url,
        ),
    )
  )
    throw new Error(
      '확인 가능한 논문 링크가 필요합니다. 일반 대화나 검색 결과 페이지는 저장하지 않습니다.',
    );
  const prepared: PreparedPaper[] = [];
  const signal = AbortSignal.any([
    AbortSignal.timeout(240000),
    ...(outerSignal ? [outerSignal] : []),
  ]);
  for (const sourceUrl of urls) {
    const id = arxivSaveId(sourceUrl);
    const cached = existing.find(
      (record) =>
        record.paper &&
        record.sourceUrls.some((url) => {
          const saved = arxivSaveId(url);
          return id
            ? saved === id || (!/v\d+$/.test(id) && saved?.replace(/v\d+$/, '') === id)
            : url === sourceUrl;
        }),
    );
    if (cached) {
      prepared.push({
        title: cached.title,
        question: cached.question,
        markdown: cached.markdown,
        sourceUrls: cached.sourceUrls,
        paper: cached.paper,
      });
      continue;
    }
    let source: LiveItem | undefined;
    let resolved: LiveItem | undefined;
    if (id)
      try {
        const url = new URL('https://export.arxiv.org/api/query');
        url.searchParams.set('id_list', id);
        const items = parseArxiv(
          await publicSourceText(url, signal),
          { keywords: [], excluded: [] },
          { ...defaultLiveSettings().papers, days: 100000 },
          new Date().toISOString(),
        );
        source = items.find((item) => {
          const found = arxivSaveId(item.sourceUrl ?? '');
          return found === id || (!/v\d+$/.test(id) && found?.replace(/v\d+$/, '') === id);
        });
      } catch (error) {
        if (signal.aborted) throw error;
      }
    if (!source) {
      const { resolvePaperSaveSource } = await import('./paper-save-source');
      resolved = await resolvePaperSaveSource(
        id ? `https://arxiv.org/abs/${id}` : sourceUrl,
        candidate.title,
        signal,
      );
      source = resolved;
    }
    if (!source || (source.paper?.excerpt || source.text).trim().length < 20)
      throw new Error('논문 원문 정보를 확인하지 못했습니다. 저장하지 않았습니다.');
    const item = resolved ?? (await enrichPaper(source, signal));
    const config = await new BriefingWorkspaceStore().desktopConfiguration();
    const routine = config.routines.find((r) => r.id === config.selectedRoutineId);
    if (!routine?.live?.assistant)
      throw new Error('Briefing Lab에서 논문 요약 모델을 설정해주세요.');
    const preferences = routedBriefingPreferences(
      routine.live.assistant,
      await routing?.(),
      'briefing',
    );
    const model = await assistantModel(preferences);
    const result = await analyzeBriefing(
      {
        routineId: routine.id,
        receiptId: randomUUID(),
        itemIds: [item.id],
        providerId: preferences.providerId,
        modelId: model.modelId,
        reasoning: preferences.reasoning,
        includeMail: false,
        memory: [],
      },
      [item],
      { keywords: [], excluded: [] },
      signal,
      () => undefined,
    );
    const insight = result.items.find((value) => value.id === item.id);
    if (!insight || PAPER_TEMPLATE_FIELDS.some((key) => !insight[key]?.trim()))
      throw new Error('논문 요약을 완료하지 못했습니다. 불완전한 항목은 저장하지 않습니다.');
    const equations = (item.paper?.equations ?? [])
      .filter((e) => insight.equationIds.includes(e.id))
      .map((e) => ({
        latex: e.latex,
        explanation:
          insight.equationExplanations?.find((v) => v.equationId === e.id)?.explanation ?? '',
      }));
    const figures = [];
    for (const figure of (item.paper?.figures ?? [])
      .filter((f) => insight.figureIds.includes(f.id))
      .slice(0, 2)) {
      let imageData: string | undefined;
      try {
        imageData = await loadPaperFigure(figure.assetUrl, item.paper!.sourceUrl, signal);
      } catch {
        if (signal.aborted) throw new Error('source_cancelled');
      }
      figures.push({ ...figure, ...(imageData ? { imageData } : {}) });
    }
    prepared.push({
      title: source.title.slice(0, 240),
      question: `논문 요약: ${source.title}`,
      sourceUrls: [source.sourceUrl!],
      markdown: ['연구 질문', '강점', '약점과 한계', '방법과 가정', '보고된 결과']
        .map((title, index) => `## ${title}\n${insight[PAPER_TEMPLATE_FIELDS[index]!]}`)
        .join('\n\n'),
      paper: {
        sourceId: source.id,
        readScope: item.paper?.readScope ?? item.readScope,
        summarizedAt: new Date().toISOString(),
        sourceDigest: createHash('sha256').update(JSON.stringify(item)).digest('hex'),
        contextDigest: createHash('sha256')
          .update(JSON.stringify({ model: model.modelId, reasoning: preferences.reasoning }))
          .digest('hex'),
        ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
        ...(source.bibliography ? { bibliography: source.bibliography } : {}),
        insight,
        equations,
        figures,
      },
    });
  }
  return prepared;
}
