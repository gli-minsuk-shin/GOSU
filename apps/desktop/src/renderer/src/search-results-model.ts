import {
  SEARCH_CATEGORIES,
  type SearchCategory,
  type SearchHit,
  type SearchResponse,
} from '../../shared/search-contracts';
import type { WorkspaceObjective } from '../../shared/workspace-contracts';
import type { WorkspaceTabId } from './workspace-views';

export const SEARCH_CATEGORY_LABELS: Readonly<Record<SearchCategory, string>> = Object.freeze({
  'project-chat': 'Project Chat',
  'research-notes': 'Research Notes',
  experiments: 'Experiments',
  'goal-metrics': 'Goal & Metrics',
  board: 'Board',
  literature: 'Literature',
  repository: 'Repository',
});

export function visibleSearchGroups(
  response: SearchResponse | null,
  category: SearchCategory | 'all',
) {
  if (!response) return [];
  return response.groups.filter((group) => category === 'all' || group.category === category);
}

export function searchResultCount(response: SearchResponse | null) {
  return response?.groups.reduce((count, group) => count + group.items.length, 0) ?? 0;
}

export function searchCategoryCount(response: SearchResponse | null, category: SearchCategory) {
  return response?.groups.find((group) => group.category === category)?.items.length ?? 0;
}

export function workspaceTabForSearchHit(hit: SearchHit): WorkspaceTabId {
  switch (hit.target.kind) {
    case 'project-chat':
      return 'chat';
    case 'research-note':
      return 'notes';
    case 'experiment':
      return 'experiments';
    case 'objective':
      return 'objective';
    case 'board-task':
      return 'board';
    case 'literature':
      return 'literature';
    case 'repository-file':
      return 'repository';
  }
}

export function objectiveSearchHitIsCurrent(
  hit: SearchHit,
  objectives: readonly WorkspaceObjective[],
) {
  if (hit.target.kind !== 'objective') return true;
  const current = objectives
    .filter((objective) => objective.projectId === hit.projectId)
    .sort((left, right) => right.objectiveVersion - left.objectiveVersion)[0];
  return (
    current?.id === hit.target.objectiveId &&
    current.objectiveVersion === hit.target.objectiveVersion
  );
}

export interface PendingSearchNavigation {
  requestId: number;
  hit: SearchHit;
}

export interface SearchTargetRequest {
  requestId: number;
  targetId: string;
}

export function consumePendingSearchNavigation(
  current: PendingSearchNavigation | null,
  requestId: number,
) {
  return current?.requestId === requestId ? null : current;
}

export function categoriesWithResults(response: SearchResponse | null) {
  return SEARCH_CATEGORIES.filter((category) => searchCategoryCount(response, category) > 0);
}
