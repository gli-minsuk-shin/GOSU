import { createBriefingPaperSearcher } from '../briefing-paper-discovery';
import { searchPapers } from '../live-public-sources';
import { publicSourceText, sourceFailureReceipt } from '../live-public-http';
// Public generic query only; no user settings, library writes, mail, credentials or LLM calls.
const start = Date.now();
const searchBriefingPapers = createBriefingPaperSearcher({
  read: async (url, signal) => {
    try {
      return await publicSourceText(url, signal);
    } catch (error) {
      console.log(
        JSON.stringify({
          provider: url.hostname,
          failure: sourceFailureReceipt(error),
          code: error instanceof Error ? error.message : 'unknown',
        }),
      );
      throw error;
    }
  },
  arxiv: async (...args) => {
    try {
      return await searchPapers(...args);
    } catch (error) {
      console.log(
        JSON.stringify({
          provider: 'arXiv',
          failure: sourceFailureReceipt(error),
          code: error instanceof Error ? error.message : 'unknown',
        }),
      );
      throw error;
    }
  },
});
try {
  const result = await searchBriefingPapers(
    { keywords: [{ term: 'neural networks', weight: 5, synonyms: [] }], excluded: [] },
    { enabled: true, days: 30, limit: 3, author: '' },
    new AbortController().signal,
  );
  console.log(
    JSON.stringify({
      elapsedMs: Date.now() - start,
      count: result.length,
      papers: result.map((i) => ({
        title: i.title,
        url: i.sourceUrl,
        date: i.publishedAt,
        source: i.source,
      })),
      notes: result[0]?.details,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      elapsedMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'failed',
    }),
  );
  process.exitCode = 1;
}
