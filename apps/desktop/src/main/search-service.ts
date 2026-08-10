import {
  SEARCH_CATEGORIES,
  SearchHitSchema,
  SearchInputSchema,
  SearchResponseSchema,
  type SearchCategory,
  type SearchHit,
  type SearchInput,
  type SearchResponse,
} from '../shared/search-contracts';
import type {
  ProjectRecord,
  WorkspaceObjective,
  WorkspaceSnapshot,
  WorkspaceTask,
} from '../shared/workspace-contracts';
import { isSearchExecutionCancelled } from './search-execution';

type MaybePromise<T> = T | Promise<T>;

export type SearchSourceCategoryReport = Readonly<{
  category: SearchCategory;
  truncated: boolean;
  incomplete: boolean;
  unavailableReason: string | null;
}>;

export type SearchDocumentResult = Readonly<{
  hits: readonly SearchHit[];
  reports: readonly SearchSourceCategoryReport[];
}>;

export interface SearchDocumentSource {
  search(input: {
    query: string;
    projectIds: readonly string[];
    projectNames: ReadonlyMap<string, string>;
    categories: readonly SearchCategory[];
    limitPerCategory: number;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): MaybePromise<SearchDocumentResult>;
}

export interface SearchWorkspaceSource {
  snapshot(): MaybePromise<WorkspaceSnapshot>;
}

export class SearchServiceError extends Error {
  constructor(
    readonly code: 'search_project_not_found' | 'search_unavailable',
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'SearchServiceError';
  }
}

const DEFAULT_SOURCE_TIMEOUT_MS = 5_000;
const SOURCE_ABORT_GRACE_MS = 50;
const SOURCE_UNAVAILABLE =
  'This local source could not be searched. Other sections remain available.';
const SOURCE_TIMED_OUT =
  'This local source took too long to search. Other sections remain available.';
const SOURCE_BUSY = 'A previous local search is still finishing. Other sections remain available.';

export class SearchService {
  private readonly activeSourceSearches = new WeakMap<
    SearchDocumentSource,
    Promise<SearchDocumentResult>
  >();

  constructor(
    private readonly dependencies: Readonly<{
      workspace: SearchWorkspaceSource;
      application?: SearchDocumentSource;
      researchNotes?: SearchDocumentSource;
      repository?: SearchDocumentSource;
      now?: () => Date;
      sourceTimeoutMs?: number;
    }>,
  ) {}

  async search(input: SearchInput): Promise<SearchResponse> {
    const command = SearchInputSchema.parse(input);
    let snapshot: WorkspaceSnapshot;
    try {
      snapshot = await this.dependencies.workspace.snapshot();
    } catch (error) {
      throw new SearchServiceError('search_unavailable', { cause: error });
    }

    const searchableProjects = snapshot.projects.filter((project) => !project.trashedAt);
    const requestedProjectId = command.scope.kind === 'project' ? command.scope.projectId : null;
    const projects = requestedProjectId
      ? searchableProjects.filter((project) => project.id === requestedProjectId)
      : searchableProjects;
    if (command.scope.kind === 'project' && projects.length !== 1) {
      throw new SearchServiceError('search_project_not_found');
    }

    const categories = uniqueCategories(command.categories ?? SEARCH_CATEGORIES);
    const projectIds = projects.map((project) => project.id);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const grouped = new Map<SearchCategory, SearchHit[]>();
    const unavailable = new Map<SearchCategory, string>();
    const sourceTruncated = new Set<SearchCategory>();
    const incomplete = new Set<SearchCategory>();
    for (const category of categories) grouped.set(category, []);

    for (const hit of workspaceHits(snapshot, projects, command.query, categories)) {
      grouped.get(hit.category)?.push(hit);
    }

    const sourceRequests: Array<{
      source: SearchDocumentSource | undefined;
      categories: readonly SearchCategory[];
    }> = [
      {
        source: this.dependencies.application,
        categories: categories.filter((category) =>
          ['project-chat', 'experiments', 'literature'].includes(category),
        ),
      },
      {
        source: this.dependencies.researchNotes,
        categories: categories.filter((category) => category === 'research-notes'),
      },
      {
        source: this.dependencies.repository,
        categories: categories.filter((category) => category === 'repository'),
      },
    ];

    await Promise.all(
      sourceRequests.map(async ({ source, categories: sourceCategories }) => {
        if (!source || sourceCategories.length === 0 || projectIds.length === 0) return;
        try {
          const timeoutMs = boundedSourceTimeout(this.dependencies.sourceTimeoutMs);
          const result = await this.runSourceSearch(source, timeoutMs, {
            query: command.query,
            projectIds,
            projectNames,
            categories: sourceCategories,
            limitPerCategory: command.limitPerCategory + 1,
          });
          for (const report of result.reports) {
            if (!sourceCategories.includes(report.category)) continue;
            if (report.truncated) sourceTruncated.add(report.category);
            if (report.incomplete) incomplete.add(report.category);
            if (report.unavailableReason)
              unavailable.set(report.category, report.unavailableReason);
          }
          for (const rawHit of result.hits) {
            const parsed = SearchHitSchema.safeParse(rawHit);
            if (
              !parsed.success ||
              !projectNames.has(parsed.data.projectId) ||
              !sourceCategories.includes(parsed.data.category)
            ) {
              for (const category of sourceCategories) incomplete.add(category);
              continue;
            }
            grouped.get(parsed.data.category)?.push(parsed.data);
          }
        } catch (error) {
          for (const category of sourceCategories) {
            incomplete.add(category);
            unavailable.set(
              category,
              error instanceof SearchSourceTimeoutError || isSearchExecutionCancelled(error)
                ? SOURCE_TIMED_OUT
                : error instanceof SearchSourceBusyError
                  ? SOURCE_BUSY
                  : SOURCE_UNAVAILABLE,
            );
          }
        }
      }),
    );

    return SearchResponseSchema.parse({
      schemaVersion: 1,
      query: command.query,
      scope: command.scope,
      groups: categories.map((category) => {
        const candidates = deduplicateHits(grouped.get(category) ?? []).sort(compareHits);
        return {
          category,
          items: candidates.slice(0, command.limitPerCategory),
          truncated: candidates.length > command.limitPerCategory || sourceTruncated.has(category),
          incomplete: incomplete.has(category),
          unavailableReason: unavailable.get(category) ?? null,
        };
      }),
      searchedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
    });
  }

  private runSourceSearch(
    source: SearchDocumentSource,
    timeoutMs: number,
    input: Omit<Parameters<SearchDocumentSource['search']>[0], 'signal' | 'deadlineAt'>,
  ) {
    if (this.activeSourceSearches.has(source)) {
      return Promise.reject(new SearchSourceBusyError());
    }
    const controller = new AbortController();
    const sourcePromise = Promise.resolve().then(() =>
      source.search({
        ...input,
        signal: controller.signal,
        deadlineAt: Date.now() + timeoutMs,
      }),
    );
    this.activeSourceSearches.set(source, sourcePromise);
    const release = () => {
      if (this.activeSourceSearches.get(source) === sourcePromise) {
        this.activeSourceSearches.delete(source);
      }
    };
    void sourcePromise.then(release, release);
    return withSourceTimeout(sourcePromise, timeoutMs, controller);
  }
}

class SearchSourceTimeoutError extends Error {
  constructor() {
    super('search_source_timed_out');
    this.name = 'SearchSourceTimeoutError';
  }
}

class SearchSourceBusyError extends Error {
  constructor() {
    super('search_source_busy');
    this.name = 'SearchSourceBusyError';
  }
}

function boundedSourceTimeout(requested: number | undefined) {
  if (requested === undefined) return DEFAULT_SOURCE_TIMEOUT_MS;
  if (!Number.isFinite(requested)) return DEFAULT_SOURCE_TIMEOUT_MS;
  return Math.max(10, Math.min(Math.trunc(requested), 30_000));
}

async function withSourceTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortGrace: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      abortGrace = setTimeout(() => reject(new SearchSourceTimeoutError()), SOURCE_ABORT_GRACE_MS);
    }, timeoutMs);
  });
  try {
    try {
      return await Promise.race([promise, timedOut]);
    } catch (error) {
      if (controller.signal.aborted) throw new SearchSourceTimeoutError();
      throw error;
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortGrace) clearTimeout(abortGrace);
  }
}

function uniqueCategories(categories: readonly SearchCategory[]) {
  return SEARCH_CATEGORIES.filter((category) => categories.includes(category));
}

function workspaceHits(
  snapshot: WorkspaceSnapshot,
  projects: readonly ProjectRecord[],
  query: string,
  categories: readonly SearchCategory[],
) {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const hits: SearchHit[] = [];
  if (categories.includes('board')) {
    for (const task of snapshot.tasks) {
      const projectName = projectNames.get(task.projectId);
      if (!projectName || task.archivedAt) continue;
      const matched = matchFields(query, {
        title: task.title,
        description: task.description ?? '',
        labels: task.labels?.join(' ') ?? '',
        status: task.status,
        priority: task.priority ?? '',
      });
      if (!matched) continue;
      hits.push(boardHit(task, projectName, matched));
    }
  }
  if (categories.includes('goal-metrics')) {
    for (const objective of latestObjectives(snapshot.objectives)) {
      const projectName = projectNames.get(objective.projectId);
      if (!projectName) continue;
      const matched = matchFields(query, {
        goal: objective.goal,
        metric: [
          objective.primaryMetric.key,
          objective.primaryMetric.displayName,
          objective.primaryMetric.unit,
          objective.primaryMetric.direction,
          objective.primaryMetric.aggregation,
        ].join(' '),
        evaluator: objective.primaryMetric.evaluatorHash,
        dataset: objective.primaryMetric.datasetHash,
        holdout: objective.primaryMetric.holdoutHash ?? '',
        baseline:
          objective.primaryMetric.baseline === null
            ? 'baseline not set'
            : `baseline ${objective.primaryMetric.baseline}`,
        target:
          objective.primaryMetric.target === null
            ? 'target not set'
            : `target ${objective.primaryMetric.target}`,
        guardrails:
          objective.guardrails.length === 0
            ? 'guardrails none'
            : objective.guardrails
                .map(
                  ({ metricKey, operator, threshold }) =>
                    `guardrail ${metricKey} ${operator} ${threshold}`,
                )
                .join(' '),
        budget: [
          `max trials ${objective.budget.maxTrials}`,
          `max concurrent trials ${objective.budget.maxConcurrentTrials}`,
          `max wall time seconds ${objective.budget.maxWallTimeSeconds}`,
          `max GPU hours ${objective.budget.maxGpuHours}`,
          `max failures ${objective.budget.maxFailures}`,
        ].join(' '),
        stopPolicy: [
          `stop when target reached ${objective.stopPolicy.stopWhenTargetReached ? 'true enabled' : 'false disabled'}`,
          `guardrail action ${objective.stopPolicy.guardrailAction}`,
          objective.stopPolicy.maxConsecutiveNoImprovement === null
            ? 'max consecutive no improvement not set'
            : `max consecutive no improvement ${objective.stopPolicy.maxConsecutiveNoImprovement}`,
        ].join(' '),
      });
      if (!matched) continue;
      hits.push(objectiveHit(objective, projectName, matched));
    }
  }
  return hits;
}

function latestObjectives(objectives: readonly WorkspaceObjective[]) {
  const byProject = new Map<string, WorkspaceObjective>();
  for (const objective of objectives) {
    const current = byProject.get(objective.projectId);
    if (!current || objective.objectiveVersion > current.objectiveVersion) {
      byProject.set(objective.projectId, objective);
    }
  }
  return [...byProject.values()];
}

function boardHit(
  task: WorkspaceTask,
  projectName: string,
  match: Readonly<{ fields: readonly string[]; snippet: string }>,
): SearchHit {
  return SearchHitSchema.parse({
    id: `board:${task.id}`,
    category: 'board',
    projectId: task.projectId,
    projectName,
    title: task.title,
    snippet: match.snippet,
    updatedAt: task.updatedAt,
    matchedFields: match.fields,
    target: { kind: 'board-task', taskId: task.id },
  });
}

function objectiveHit(
  objective: WorkspaceObjective,
  projectName: string,
  match: Readonly<{ fields: readonly string[]; snippet: string }>,
): SearchHit {
  return SearchHitSchema.parse({
    id: `objective:${objective.id}:${objective.objectiveVersion}`,
    category: 'goal-metrics',
    projectId: objective.projectId,
    projectName,
    title: `Objective v${objective.objectiveVersion} · ${objective.primaryMetric.displayName}`,
    snippet: match.snippet,
    updatedAt: objective.updatedAt,
    matchedFields: match.fields,
    target: {
      kind: 'objective',
      objectiveId: objective.id,
      objectiveVersion: objective.objectiveVersion,
    },
  });
}

function normalize(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function queryTokens(query: string) {
  return normalize(query).split(/\s+/u).filter(Boolean).slice(0, 16);
}

export function matchFields(
  query: string,
  fields: Readonly<Record<string, string>>,
): Readonly<{ fields: readonly string[]; snippet: string }> | null {
  const tokens = queryTokens(query);
  const entries = Object.entries(fields).map(([name, value]) => ({
    name,
    value: value.replace(/\s+/gu, ' ').trim(),
    normalized: normalize(value),
  }));
  if (
    tokens.length === 0 ||
    !tokens.every((token) => entries.some((entry) => entry.normalized.includes(token)))
  ) {
    return null;
  }
  const matchedFields = entries
    .filter((entry) => tokens.some((token) => entry.normalized.includes(token)))
    .map((entry) => entry.name);
  const preferred = entries.find((entry) =>
    tokens.some((token) => entry.normalized.includes(token)),
  );
  return {
    fields: matchedFields,
    snippet: boundedSnippet(preferred?.value ?? '', tokens[0] ?? ''),
  };
}

export function boundedSnippet(value: string, normalizedNeedle: string, maximum = 320) {
  const compact = value.replace(/\s+/gu, ' ').trim();
  if (compact.length <= maximum) return compact;
  const index = normalize(compact).indexOf(normalizedNeedle);
  const start = Math.max(0, Math.min(index < 0 ? 0 : index - 80, compact.length - maximum));
  const content = compact.slice(start, start + maximum).trim();
  return `${start > 0 ? '…' : ''}${content}${start + maximum < compact.length ? '…' : ''}`;
}

function compareHits(left: SearchHit, right: SearchHit) {
  const updated = Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? '');
  if (Number.isFinite(updated) && updated !== 0) return updated;
  return left.title.localeCompare(right.title);
}

function deduplicateHits(hits: readonly SearchHit[]) {
  const byId = new Map<string, SearchHit>();
  for (const hit of hits) {
    if (!byId.has(hit.id)) byId.set(hit.id, hit);
  }
  return [...byId.values()];
}
