import type { ExperimentIdea } from '../shared/experiment-workspace-contracts';
import type { LiteratureRecord } from '../shared/literature-contracts';
import { SearchHitSchema, type SearchCategory, type SearchHit } from '../shared/search-contracts';
import {
  boundedSnippet,
  matchFields,
  type SearchDocumentResult,
  type SearchDocumentSource,
  type SearchSourceCategoryReport,
} from './search-service';
import { searchExecutionCancelled, type SearchExecution } from './search-execution';

export type ProjectChatSearchRow = Readonly<{
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  role: 'user' | 'assistant';
  content: string;
  updatedAt: string;
}>;

export type ExperimentMetricSearchRow = Readonly<{
  projectId: string;
  metricPointId: string;
  ideaId: string;
  ideaTitle: string;
  metricKey: string;
  metricDisplayName: string;
  value: number;
  unit: string | null;
  aggregation: string;
  baseline: number | null;
  target: number | null;
  source: string;
  trialId: string | null;
  sequence: number;
  objectiveVersion: number;
  updatedAt: string;
}>;

export interface ApplicationSearchStorage {
  searchProjectChatMessages(
    projectIds: readonly string[],
    query: string,
    limit: number,
  ): readonly (ProjectChatSearchRow & { projectId: string })[];
  searchExperimentIdeas(
    projectIds: readonly string[],
    query: string,
    limit: number,
  ): readonly ExperimentIdea[];
  searchExperimentMetricPoints(
    projectIds: readonly string[],
    query: string,
    limit: number,
  ): readonly ExperimentMetricSearchRow[];
  searchLiteratureRecords(
    projectIds: readonly string[],
    query: string,
    limit: number,
  ): readonly LiteratureRecord[];
}

const MAX_PROJECTS_PER_LOCAL_QUERY = 128;

export class ApplicationSearchSource implements SearchDocumentSource {
  constructor(private readonly storage: ApplicationSearchStorage) {}

  search(input: {
    query: string;
    projectIds: readonly string[];
    projectNames: ReadonlyMap<string, string>;
    categories: readonly SearchCategory[];
    limitPerCategory: number;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): SearchDocumentResult {
    const hits: SearchHit[] = [];
    const reports: SearchSourceCategoryReport[] = [];
    if (input.categories.includes('project-chat')) {
      try {
        const search = searchAcrossProjectChunks(
          input.projectIds,
          input.query,
          input.limitPerCategory,
          (projectIds, query, limit) =>
            this.storage.searchProjectChatMessages(projectIds, query, limit),
          input,
        );
        const rows = search.items;
        for (const row of rows) {
          const projectName = input.projectNames.get(row.projectId);
          if (!projectName) continue;
          const matched = matchFields(input.query, {
            content: row.content,
            session: row.sessionTitle,
            role: row.role,
          });
          if (!matched) continue;
          hits.push(
            SearchHitSchema.parse({
              id: `chat:${row.messageId}`,
              category: 'project-chat',
              projectId: row.projectId,
              projectName,
              title: `${row.sessionTitle} · ${row.role === 'user' ? 'You' : 'GOSU'}`,
              snippet: matched.snippet,
              updatedAt: row.updatedAt,
              matchedFields: matched.fields,
              target: {
                kind: 'project-chat',
                sessionId: row.sessionId,
                messageId: row.messageId,
              },
            }),
          );
        }
        reports.push(searchReport('project-chat', search));
      } catch {
        reports.push(failedReport('project-chat'));
      }
    }

    if (input.categories.includes('experiments')) {
      try {
        const ideaSearch = searchAcrossProjectChunks(
          input.projectIds,
          input.query,
          input.limitPerCategory,
          (projectIds, query, limit) =>
            this.storage.searchExperimentIdeas(projectIds, query, limit),
          input,
        );
        const ideas = ideaSearch.items;
        for (const idea of ideas) {
          const projectName = input.projectNames.get(idea.projectId);
          if (!projectName) continue;
          const matched = matchFields(input.query, {
            title: idea.title,
            hypothesis: idea.hypothesis,
            phase: idea.phase,
            outcome: idea.outcome,
            result: idea.resultSummary,
          });
          if (!matched) continue;
          hits.push(
            SearchHitSchema.parse({
              id: `experiment:${idea.id}`,
              category: 'experiments',
              projectId: idea.projectId,
              projectName,
              title: idea.title,
              snippet: matched.snippet,
              updatedAt: idea.updatedAt,
              matchedFields: matched.fields,
              target: { kind: 'experiment', ideaId: idea.id },
            }),
          );
        }

        const metricSearch = searchAcrossProjectChunks(
          input.projectIds,
          input.query,
          input.limitPerCategory,
          (projectIds, query, limit) =>
            this.storage.searchExperimentMetricPoints(projectIds, query, limit),
          input,
        );
        for (const point of metricSearch.items) {
          const projectName = input.projectNames.get(point.projectId);
          if (!projectName) continue;
          const matched = matchFields(input.query, {
            idea: point.ideaTitle,
            metric: `metric ${point.metricDisplayName} ${point.metricKey}`,
            value: `value ${point.value}${point.unit ? ` ${point.unit}` : ''}`,
            trial: point.trialId ? `trial ${point.trialId}` : '',
            series: `series ${point.metricKey} ${point.aggregation} objective version ${point.objectiveVersion}`,
            baseline:
              point.baseline === null
                ? ''
                : `baseline ${point.baseline}${point.unit ? ` ${point.unit}` : ''}`,
            target:
              point.target === null
                ? ''
                : `target ${point.target}${point.unit ? ` ${point.unit}` : ''}`,
            source: `source ${point.source} sequence ${point.sequence}`,
          });
          if (!matched) continue;
          hits.push(
            SearchHitSchema.parse({
              id: `experiment-metric:${point.metricPointId}`,
              category: 'experiments',
              projectId: point.projectId,
              projectName,
              title: boundedExperimentMetricTitle(point),
              snippet: matched.snippet,
              updatedAt: point.updatedAt,
              matchedFields: matched.fields,
              target: { kind: 'experiment', ideaId: point.ideaId },
            }),
          );
        }
        reports.push(
          searchReport('experiments', combineChunkedSearchResults([ideaSearch, metricSearch])),
        );
      } catch {
        reports.push(failedReport('experiments'));
      }
    }
    if (input.categories.includes('literature')) {
      try {
        const search = searchAcrossProjectChunks(
          input.projectIds,
          input.query,
          input.limitPerCategory,
          (projectIds, query, limit) =>
            this.storage.searchLiteratureRecords(projectIds, query, limit),
          input,
        );
        const records = search.items;
        for (const record of records) {
          const projectName = input.projectNames.get(record.projectId);
          if (!projectName) continue;
          const matched = matchFields(input.query, {
            title: record.title,
            authors: record.authors.join(' '),
            venue: record.containerTitle ?? '',
            doi: record.doi ? `DOI ${record.doi}` : '',
            citationKey: record.citationKey ? `citation key ${record.citationKey}` : '',
            publicationYear:
              record.publishedYear === null ? '' : `publication year ${record.publishedYear}`,
            citationCount:
              record.citationCount === null ? '' : `citation count ${record.citationCount}`,
            topics: record.sourceTopics.join(' '),
            tags: [
              ...(record.searchTags?.topics ?? []),
              ...(record.searchTags?.keywords ?? []),
            ].join(' '),
            notes: [
              record.manualAnnotations.summary,
              record.manualAnnotations.relevance,
              ...record.manualAnnotations.topics,
              record.aiAnnotations?.summary ?? '',
              ...(record.aiAnnotations?.topics ?? []),
              record.aiAnnotations?.studyType ?? '',
              ...(record.aiAnnotations?.limitations ?? []),
            ].join(' '),
          });
          if (!matched) continue;
          hits.push(
            SearchHitSchema.parse({
              id: `literature:${record.id}`,
              category: 'literature',
              projectId: record.projectId,
              projectName,
              title: record.title,
              snippet: matched.snippet || boundedSnippet(record.title, input.query),
              updatedAt: record.updatedAt,
              matchedFields: matched.fields,
              target: { kind: 'literature', recordId: record.id },
            }),
          );
        }
        reports.push(searchReport('literature', search));
      } catch {
        reports.push(failedReport('literature'));
      }
    }
    return { hits, reports };
  }
}

function boundedExperimentMetricTitle(point: ExperimentMetricSearchRow) {
  const unit = point.unit ? ` ${point.unit}` : '';
  return `${point.ideaTitle} · ${point.metricDisplayName} = ${point.value}${unit}`.slice(0, 512);
}

type ProjectSearchRecord = Readonly<{ projectId: string; updatedAt: string }>;

type ChunkedSearchResult<T extends ProjectSearchRecord> = Readonly<{
  items: readonly T[];
  truncated: boolean;
  incomplete: boolean;
  allFailed: boolean;
}>;

function combineChunkedSearchResults(
  results: readonly ChunkedSearchResult<ProjectSearchRecord>[],
): Pick<ChunkedSearchResult<ProjectSearchRecord>, 'truncated' | 'incomplete' | 'allFailed'> {
  return {
    truncated: results.some(({ truncated }) => truncated),
    incomplete: results.some(({ incomplete }) => incomplete),
    allFailed: results.length > 0 && results.every(({ allFailed }) => allFailed),
  };
}

function searchAcrossProjectChunks<T extends ProjectSearchRecord>(
  projectIds: readonly string[],
  query: string,
  limit: number,
  search: (projectIds: readonly string[], query: string, limit: number) => readonly T[],
  execution: SearchExecution = {},
): ChunkedSearchResult<T> {
  const items: T[] = [];
  let attempts = 0;
  let failures = 0;
  let truncated = false;
  let cancelled = false;
  for (let offset = 0; offset < projectIds.length; offset += MAX_PROJECTS_PER_LOCAL_QUERY) {
    if (searchExecutionCancelled(execution)) {
      cancelled = true;
      break;
    }
    const chunk = projectIds.slice(offset, offset + MAX_PROJECTS_PER_LOCAL_QUERY);
    if (chunk.length === 0) continue;
    attempts += 1;
    try {
      const chunkItems = search(chunk, query, limit);
      items.push(...chunkItems);
      truncated ||= chunkItems.length >= limit;
    } catch {
      failures += 1;
    }
  }
  items.sort((left, right) => {
    const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (Number.isFinite(updated) && updated !== 0) return updated;
    return left.projectId.localeCompare(right.projectId);
  });
  truncated ||= cancelled || items.length > limit;
  return {
    items: items.slice(0, limit),
    truncated,
    incomplete: failures > 0 || cancelled,
    allFailed: attempts > 0 && failures === attempts,
  };
}

function searchReport(
  category: SearchCategory,
  result: Pick<ChunkedSearchResult<ProjectSearchRecord>, 'truncated' | 'incomplete' | 'allFailed'>,
): SearchSourceCategoryReport {
  if (!result.incomplete) return completeReport(category, result.truncated);
  return {
    category,
    truncated: result.truncated,
    incomplete: true,
    unavailableReason: result.allFailed
      ? 'This local section could not be searched. Other results are still shown.'
      : 'Some projects in this local section could not be searched. Available results are still shown.',
  };
}

function completeReport(category: SearchCategory, truncated: boolean): SearchSourceCategoryReport {
  return { category, truncated, incomplete: false, unavailableReason: null };
}

function failedReport(category: SearchCategory): SearchSourceCategoryReport {
  return {
    category,
    truncated: false,
    incomplete: true,
    unavailableReason: 'This local section could not be searched. Other results are still shown.',
  };
}
