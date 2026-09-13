import type { PaperSummaryRecord } from './paper-summary-contract';
import type { SavedPaper } from './paper-library-index';
export function sharedPaperView(record: PaperSummaryRecord): SavedPaper {
  if (record.paper)
    return {
      historyId: 'shared:' + record.id,
      savedAt: record.savedAt,
      item: {
        ...record.paper.insight,
        id: record.id,
        title: record.title,
        kind: 'papers',
        sourceUrl: record.sourceUrls[0],
        readScope: record.paper.readScope,
        paperPublishedAt: record.paper.publishedAt,
        bibliography: record.paper.bibliography,
        equations: record.paper.equations,
        figures: record.paper.figures,
        provenance: {
          version: 1,
          sourceDigest: record.paper.sourceDigest,
          contextDigest: record.paper.contextDigest,
          summarizedAt: record.paper.summarizedAt,
          reused: true,
        },
      },
    };
  return {
    historyId: 'shared:' + record.id,
    savedAt: record.savedAt,
    item: {
      id: record.id,
      title: record.title,
      kind: 'papers',
      readScope: 'chat-analysis',
      ...(record.sourceUrls.length === 1 ? { sourceUrl: record.sourceUrls[0] } : {}),
      summary:
        '대화에서 분석한 내용을 사용자가 승인해 저장했습니다. 원문을 새로 조회한 결과가 아닙니다.',
      detail: record.markdown,
      importance: 'uncertain',
      relevance: '',
      keywords: [],
      tags: [],
      importanceReason: '대화에서 저장한 분석 · 별도 우선순위 평가 없음',
      action: '',
    },
  };
}
