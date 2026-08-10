import { createHash } from 'node:crypto';
import { basename } from 'node:path/posix';

import type { GitFileSearchInput, GitFileSearchResult } from '../shared/git-workspace-contracts';
import { SearchHitSchema, type SearchCategory, type SearchHit } from '../shared/search-contracts';
import {
  matchFields,
  type SearchDocumentResult,
  type SearchDocumentSource,
} from './search-service';
import {
  isSearchExecutionCancelled,
  PendingSearchOperations,
  searchExecutionCancelled,
  waitForSearchOperation,
} from './search-execution';

const PARTIAL_REPOSITORY_FAILURE =
  'Some local repositories could not be searched. Other projects remain available.';
const ALL_REPOSITORIES_FAILED =
  'Local repositories could not be searched. Other sections remain available.';
const REPOSITORY_DEADLINE_REACHED =
  'Repository search reached its time limit. Available projects are still shown.';

export interface RepositorySearchReader {
  searchFiles(input: GitFileSearchInput, signal?: AbortSignal): Promise<GitFileSearchResult>;
}

export class RepositorySearchSource implements SearchDocumentSource {
  private readonly pendingOperations = new PendingSearchOperations();

  constructor(private readonly repository: RepositorySearchReader) {}

  async search(input: {
    query: string;
    projectIds: readonly string[];
    projectNames: ReadonlyMap<string, string>;
    categories: readonly SearchCategory[];
    limitPerCategory: number;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<SearchDocumentResult> {
    if (!input.categories.includes('repository')) return { hits: [], reports: [] };
    if (this.pendingOperations.busy) return pendingOperationResult();
    const hits: SearchHit[] = [];
    let attemptedProjects = 0;
    let failedProjects = 0;
    let sourceTruncated = false;
    let incomplete = false;
    let deadlineReached = searchExecutionCancelled(input);
    for (const projectId of input.projectIds) {
      if (searchExecutionCancelled(input)) {
        deadlineReached = true;
        break;
      }
      const projectName = input.projectNames.get(projectId);
      if (!projectName) continue;
      attemptedProjects += 1;
      let result: GitFileSearchResult;
      try {
        const command = {
          projectId,
          query: input.query,
          limit: input.limitPerCategory,
        };
        const operation = this.pendingOperations.track(
          Promise.resolve().then(() =>
            input.signal
              ? this.repository.searchFiles(command, input.signal)
              : this.repository.searchFiles(command),
          ),
        );
        result = await waitForSearchOperation(operation, input);
      } catch (error) {
        if (isSearchExecutionCancelled(error)) {
          deadlineReached = true;
          incomplete = true;
          sourceTruncated = true;
          break;
        }
        failedProjects += 1;
        incomplete = true;
        continue;
      }
      sourceTruncated ||= result.truncated;
      incomplete ||= result.incomplete;
      for (const entry of result.entries) {
        if (entry.kind !== 'file') continue;
        const matched = matchFields(input.query, {
          name: basename(entry.path),
          path: entry.path,
        });
        if (!matched) {
          incomplete = true;
          continue;
        }
        const parsed = SearchHitSchema.safeParse({
          id: repositoryHitId(projectId, entry.path),
          category: 'repository',
          projectId,
          projectName,
          title: basename(entry.path),
          snippet: entry.path,
          updatedAt: null,
          matchedFields: matched.fields,
          target: { kind: 'repository-file', path: entry.path },
        });
        if (!parsed.success) {
          incomplete = true;
          continue;
        }
        hits.push(parsed.data);
      }
    }

    sourceTruncated ||= deadlineReached || hits.length > input.limitPerCategory;
    incomplete ||= deadlineReached;
    const allFailed = attemptedProjects > 0 && failedProjects === attemptedProjects;
    return {
      hits,
      reports: [
        {
          category: 'repository',
          truncated: sourceTruncated,
          incomplete,
          unavailableReason: deadlineReached
            ? REPOSITORY_DEADLINE_REACHED
            : failedProjects === 0
              ? null
              : allFailed
                ? ALL_REPOSITORIES_FAILED
                : PARTIAL_REPOSITORY_FAILURE,
        },
      ],
    };
  }
}

function pendingOperationResult(): SearchDocumentResult {
  return {
    hits: [],
    reports: [
      {
        category: 'repository',
        truncated: true,
        incomplete: true,
        unavailableReason:
          'A previous repository search is still finishing. Other sections remain available.',
      },
    ],
  };
}

function repositoryHitId(projectId: string, path: string) {
  const digest = createHash('sha256').update(projectId).update('\0').update(path).digest('hex');
  return `repository:${digest}`;
}
