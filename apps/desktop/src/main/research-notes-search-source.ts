import { createHash } from 'node:crypto';
import { basename } from 'node:path/posix';

import type { ResearchNotesWorkspace } from '../shared/research-notes-contracts';
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

const MAX_SEARCHED_NOTES = 240;
const MAX_SEARCHED_CHARACTERS = 8_000_000;
const MAX_NOTE_SEARCH_CHARACTERS = 160_000;

export interface ResearchNotesSearchReader {
  inspectReadyWorkspace(
    input: { projectId: string },
    signal?: AbortSignal,
  ): Promise<ResearchNotesWorkspace | null>;
  readReadyMarkdown(
    input: {
      projectId: string;
      path: string;
    },
    signal?: AbortSignal,
  ): Promise<{ path: string; content: string }>;
}

export class ResearchNotesSearchSource implements SearchDocumentSource {
  private readonly pendingOperations = new PendingSearchOperations();

  constructor(private readonly notes: ResearchNotesSearchReader) {}

  async search(input: {
    query: string;
    projectIds: readonly string[];
    projectNames: ReadonlyMap<string, string>;
    categories: readonly SearchCategory[];
    limitPerCategory: number;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<SearchDocumentResult> {
    if (!input.categories.includes('research-notes')) return { hits: [], reports: [] };
    if (this.pendingOperations.busy) return pendingOperationResult();
    const hits: SearchHit[] = [];
    let searchedFiles = 0;
    let searchedCharacters = 0;
    let inspectionFailures = 0;
    let readFailures = 0;
    let deadlineReached = searchExecutionCancelled(input);
    const projects: Array<{
      projectId: string;
      projectName: string;
      files: readonly string[];
      cursor: number;
    }> = [];

    for (const projectId of input.projectIds) {
      if (searchExecutionCancelled(input)) {
        deadlineReached = true;
        break;
      }
      const projectName = input.projectNames.get(projectId);
      if (!projectName) continue;
      let workspace: ResearchNotesWorkspace | null;
      try {
        const operation = this.pendingOperations.track(
          Promise.resolve().then(() =>
            input.signal
              ? this.notes.inspectReadyWorkspace({ projectId }, input.signal)
              : this.notes.inspectReadyWorkspace({ projectId }),
          ),
        );
        workspace = await waitForSearchOperation(operation, input);
      } catch (error) {
        if (isSearchExecutionCancelled(error)) {
          deadlineReached = true;
          break;
        }
        inspectionFailures += 1;
        continue;
      }
      if (!workspace || workspace.status !== 'ready') continue;
      projects.push({
        projectId,
        projectName,
        files: prioritizePathMatches(workspace.files, input.query),
        cursor: 0,
      });
    }

    search: while (
      !deadlineReached &&
      hits.length < input.limitPerCategory &&
      searchedFiles < MAX_SEARCHED_NOTES &&
      searchedCharacters < MAX_SEARCHED_CHARACTERS
    ) {
      let visitedFile = false;
      for (const project of projects) {
        if (searchExecutionCancelled(input)) {
          deadlineReached = true;
          break search;
        }
        if (
          hits.length >= input.limitPerCategory ||
          searchedFiles >= MAX_SEARCHED_NOTES ||
          searchedCharacters >= MAX_SEARCHED_CHARACTERS
        ) {
          break search;
        }
        const path = project.files[project.cursor];
        if (path === undefined) continue;
        project.cursor += 1;
        visitedFile = true;
        searchedFiles += 1;
        let note: { path: string; content: string };
        try {
          const operation = this.pendingOperations.track(
            Promise.resolve().then(() =>
              input.signal
                ? this.notes.readReadyMarkdown({ projectId: project.projectId, path }, input.signal)
                : this.notes.readReadyMarkdown({ projectId: project.projectId, path }),
            ),
          );
          note = await waitForSearchOperation(operation, input);
        } catch (error) {
          if (isSearchExecutionCancelled(error)) {
            deadlineReached = true;
            break search;
          }
          readFailures += 1;
          continue;
        }
        const content = note.content.slice(
          0,
          Math.min(MAX_NOTE_SEARCH_CHARACTERS, MAX_SEARCHED_CHARACTERS - searchedCharacters),
        );
        searchedCharacters += content.length;
        const matched = matchFields(input.query, {
          title: basename(note.path, '.md'),
          path: note.path,
          content,
        });
        if (!matched) continue;
        hits.push(
          SearchHitSchema.parse({
            id: noteHitId(project.projectId, note.path),
            category: 'research-notes',
            projectId: project.projectId,
            projectName: project.projectName,
            title: basename(note.path, '.md'),
            snippet: matched.snippet,
            updatedAt: frontmatterModifiedAt(content),
            matchedFields: matched.fields,
            target: { kind: 'research-note', path: note.path },
          }),
        );
        if (
          hits.length >= input.limitPerCategory ||
          searchedFiles >= MAX_SEARCHED_NOTES ||
          searchedCharacters >= MAX_SEARCHED_CHARACTERS
        ) {
          break search;
        }
      }
      if (!visitedFile) break;
    }

    const hasUnsearchedFiles = projects.some((project) => project.cursor < project.files.length);
    const budgetExhausted =
      hasUnsearchedFiles &&
      (searchedFiles >= MAX_SEARCHED_NOTES || searchedCharacters >= MAX_SEARCHED_CHARACTERS);
    const incomplete =
      deadlineReached || inspectionFailures > 0 || readFailures > 0 || budgetExhausted;
    const unavailableReason = deadlineReached
      ? 'Research Notes search reached its time limit. Available notes are still shown.'
      : budgetExhausted
        ? 'Research Notes search reached its local safety limit; some notes were not searched.'
        : inspectionFailures > 0 && projects.length === 0
          ? 'Research Notes could not be searched for the available projects.'
          : inspectionFailures > 0 || readFailures > 0
            ? 'Some Research Notes could not be searched. Available notes are still shown.'
            : null;
    return {
      hits,
      reports: [
        {
          category: 'research-notes',
          truncated:
            deadlineReached ||
            (hasUnsearchedFiles && (hits.length >= input.limitPerCategory || budgetExhausted)),
          incomplete,
          unavailableReason,
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
        category: 'research-notes',
        truncated: true,
        incomplete: true,
        unavailableReason:
          'A previous Research Notes search is still finishing. Other sections remain available.',
      },
    ],
  };
}

function noteHitId(projectId: string, path: string) {
  return `research-note:${createHash('sha256').update(`${projectId}\0${path}`).digest('hex')}`;
}

function prioritizePathMatches(paths: readonly string[], query: string) {
  const normalizedQuery = query.normalize('NFKC').toLocaleLowerCase();
  return [...paths].sort((left, right) => {
    const leftMatch = left.normalize('NFKC').toLocaleLowerCase().includes(normalizedQuery);
    const rightMatch = right.normalize('NFKC').toLocaleLowerCase().includes(normalizedQuery);
    if (leftMatch !== rightMatch) return leftMatch ? -1 : 1;
    return left.localeCompare(right);
  });
}

function frontmatterModifiedAt(content: string) {
  const header = content.startsWith('---\n') ? content.slice(0, 8_192) : '';
  const match = header.match(/^modified_at:\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*$/mu);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
