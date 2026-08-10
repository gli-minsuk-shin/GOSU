import { describe, expect, it, vi } from 'vitest';

import { ApplicationSearchSource } from '../src/main/application-search-source';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID = '00000000-0000-4000-8000-000000000002';
const MESSAGE_ID = '00000000-0000-4000-8000-000000000003';
const IDEA_ID = '00000000-0000-4000-8000-000000000004';
const RECORD_ID = '00000000-0000-4000-8000-000000000005';

describe('ApplicationSearchSource', () => {
  it('returns bounded navigation records for chat, experiments, and literature', () => {
    const source = new ApplicationSearchSource({
      searchProjectChatMessages: () => [
        {
          projectId: PROJECT_ID,
          messageId: MESSAGE_ID,
          sessionId: SESSION_ID,
          sessionTitle: 'Baseline analysis',
          role: 'assistant',
          content: 'The tabular baseline reached 71 percent.',
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
      ],
      searchExperimentIdeas: () => [
        {
          schemaVersion: 1,
          id: IDEA_ID,
          projectId: PROJECT_ID,
          parentIdeaId: null,
          title: 'Tabular baseline',
          hypothesis: 'A stronger preprocessing baseline will improve accuracy.',
          phase: 'Reproduce',
          outcome: 'success',
          resultSummary: 'Reached 71 percent.',
          version: 2,
          createdAt: '2026-08-09T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
          completedAt: '2026-08-10T00:00:00.000Z',
        },
      ],
      searchExperimentMetricPoints: () => [
        {
          projectId: PROJECT_ID,
          metricPointId: '00000000-0000-4000-8000-000000000006',
          ideaId: IDEA_ID,
          ideaTitle: 'Tabular baseline',
          metricKey: 'holdout.accuracy',
          metricDisplayName: 'Holdout accuracy',
          value: 0.71,
          unit: '%',
          aggregation: 'mean',
          baseline: 0.65,
          target: 0.75,
          source: 'runner-summary',
          trialId: 'trial-tabular-007',
          sequence: 7,
          objectiveVersion: 2,
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
      ],
      searchLiteratureRecords: () => [
        {
          schemaVersion: 1,
          id: RECORD_ID,
          projectId: PROJECT_ID,
          provider: 'semantic-scholar',
          providerRecordId: 'paper-1',
          canonicalId: 'arxiv:2601.00001',
          doi: null,
          fingerprint: 'a'.repeat(64),
          title: 'Tabular Foundation Models',
          authors: ['Researcher'],
          containerTitle: 'Journal',
          publishedYear: 2026,
          sourceTopics: ['tabular learning'],
          searchTags: { topics: ['foundation models'], keywords: ['tabular'] },
          workType: 'article',
          citationCount: 10,
          sourceUrl: 'https://arxiv.org/abs/2601.00001',
          citationKey: 'researcher2026tabular',
          reviewStatus: 'included',
          manualAnnotations: { topics: [], summary: '', relevance: '' },
          aiAnnotations: null,
          discovery: null,
          annotationVersion: 0,
          version: 1,
          createdAt: '2026-08-09T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
      ],
    });

    const results = source.search({
      query: 'tabular',
      projectIds: [PROJECT_ID],
      projectNames: new Map([[PROJECT_ID, 'FM project']]),
      categories: ['project-chat', 'experiments', 'literature'],
      limitPerCategory: 20,
    });
    expect(results.hits.map((hit) => hit.target.kind)).toEqual([
      'project-chat',
      'experiment',
      'experiment',
      'literature',
    ]);
    expect(results.reports).toHaveLength(3);
    expect(JSON.stringify(results)).not.toContain('/Users/');
  });

  it('searches bounded experiment metric and literature identity summaries without raw data', () => {
    const source = new ApplicationSearchSource({
      searchProjectChatMessages: () => [],
      searchExperimentIdeas: () => [],
      searchExperimentMetricPoints: () => [
        {
          projectId: PROJECT_ID,
          metricPointId: '00000000-0000-4000-8000-000000000006',
          ideaId: IDEA_ID,
          ideaTitle: 'Tabular baseline',
          metricKey: 'validation.rmse',
          metricDisplayName: 'Validation RMSE',
          value: 0.95,
          unit: 'rmse',
          aggregation: 'mean',
          baseline: 1.25,
          target: 1,
          source: 'runner-summary',
          trialId: 'trial-001',
          sequence: 3,
          objectiveVersion: 2,
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
      ],
      searchLiteratureRecords: () => [
        {
          schemaVersion: 1,
          id: RECORD_ID,
          projectId: PROJECT_ID,
          provider: 'crossref',
          providerRecordId: 'paper-1',
          canonicalId: null,
          doi: '10.1000/tabular.2026',
          fingerprint: 'a'.repeat(64),
          title: 'Foundation Models for Tables',
          authors: ['Researcher'],
          containerTitle: 'Journal',
          publishedYear: 2026,
          sourceTopics: [],
          searchTags: { topics: [], keywords: [] },
          workType: 'article',
          citationCount: 314,
          sourceUrl: 'https://doi.org/10.1000/tabular.2026',
          citationKey: 'researcher2026tables',
          reviewStatus: 'included',
          manualAnnotations: { topics: [], summary: '', relevance: '' },
          aiAnnotations: null,
          discovery: null,
          annotationVersion: 0,
          version: 1,
          createdAt: '2026-08-09T00:00:00.000Z',
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
      ],
    });

    const metric = source.search({
      query: 'trial-001 0.95',
      projectIds: [PROJECT_ID],
      projectNames: new Map([[PROJECT_ID, 'FM project']]),
      categories: ['experiments'],
      limitPerCategory: 20,
    });
    expect(metric.hits).toMatchObject([
      {
        id: 'experiment-metric:00000000-0000-4000-8000-000000000006',
        matchedFields: ['value', 'trial'],
        target: { kind: 'experiment', ideaId: IDEA_ID },
      },
    ]);
    expect(JSON.stringify(metric)).not.toContain('dataset');

    for (const query of ['10.1000/tabular.2026', 'researcher2026tables', '2026', '314']) {
      const literature = source.search({
        query,
        projectIds: [PROJECT_ID],
        projectNames: new Map([[PROJECT_ID, 'FM project']]),
        categories: ['literature'],
        limitPerCategory: 20,
      });
      expect(literature.hits).toHaveLength(1);
      expect(literature.hits[0]?.target).toEqual({ kind: 'literature', recordId: RECORD_ID });
    }
  });

  it('isolates a failed category while preserving other application results', () => {
    const source = new ApplicationSearchSource({
      searchProjectChatMessages: () => {
        throw new Error('chat unavailable');
      },
      searchExperimentIdeas: () => [],
      searchExperimentMetricPoints: () => [],
      searchLiteratureRecords: () => [],
    });
    const result = source.search({
      query: 'baseline',
      projectIds: [PROJECT_ID],
      projectNames: new Map([[PROJECT_ID, 'FM project']]),
      categories: ['project-chat', 'experiments'],
      limitPerCategory: 20,
    });
    expect(result.reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'project-chat', incomplete: true }),
        expect.objectContaining({ category: 'experiments', incomplete: false }),
      ]),
    );
  });

  it('chunks a large global project scope without starving later projects', () => {
    const projectIds = Array.from(
      { length: 129 },
      (_, index) => `00000000-0000-4000-8000-${(index + 100).toString(16).padStart(12, '0')}`,
    );
    const lastProjectId = projectIds.at(-1)!;
    const searchProjectChatMessages = vi.fn((ids: readonly string[]) => {
      if (ids.length === 128) throw new Error('first chunk unavailable');
      return ids.includes(lastProjectId)
        ? [
            {
              projectId: lastProjectId,
              messageId: MESSAGE_ID,
              sessionId: SESSION_ID,
              sessionTitle: 'Later project',
              role: 'assistant' as const,
              content: 'globally unique evidence',
              updatedAt: '2026-08-10T00:00:00.000Z',
            },
          ]
        : [];
    });
    const source = new ApplicationSearchSource({
      searchProjectChatMessages,
      searchExperimentIdeas: () => [],
      searchExperimentMetricPoints: () => [],
      searchLiteratureRecords: () => [],
    });

    const result = source.search({
      query: 'globally unique',
      projectIds,
      projectNames: new Map(projectIds.map((projectId) => [projectId, projectId])),
      categories: ['project-chat'],
      limitPerCategory: 20,
    });

    expect(searchProjectChatMessages).toHaveBeenCalledTimes(2);
    expect(searchProjectChatMessages.mock.calls.map(([ids]) => ids.length)).toEqual([128, 1]);
    expect(result.hits).toMatchObject([{ projectId: lastProjectId }]);
    expect(result.reports[0]).toMatchObject({
      incomplete: true,
      truncated: false,
      unavailableReason: expect.stringContaining('Some projects'),
    });
  });

  it('stops before another SQL chunk after its deadline and keeps the first chunk matches', () => {
    const projectIds = Array.from(
      { length: 129 },
      (_, index) => `00000000-0000-4000-8000-${(index + 500).toString(16).padStart(12, '0')}`,
    );
    const firstProjectId = projectIds[0]!;
    let currentTime = 100;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const searchProjectChatMessages = vi.fn((ids: readonly string[]) => {
      currentTime = 201;
      return [
        {
          projectId: ids[0]!,
          messageId: MESSAGE_ID,
          sessionId: SESSION_ID,
          sessionTitle: 'Bounded search',
          role: 'assistant' as const,
          content: 'deadline evidence',
          updatedAt: '2026-08-10T00:00:00.000Z',
        },
      ];
    });
    const source = new ApplicationSearchSource({
      searchProjectChatMessages,
      searchExperimentIdeas: () => [],
      searchExperimentMetricPoints: () => [],
      searchLiteratureRecords: () => [],
    });

    try {
      const result = source.search({
        query: 'deadline evidence',
        projectIds,
        projectNames: new Map(projectIds.map((projectId) => [projectId, projectId])),
        categories: ['project-chat'],
        limitPerCategory: 20,
        deadlineAt: 200,
      });

      expect(searchProjectChatMessages).toHaveBeenCalledTimes(1);
      expect(result.hits).toMatchObject([{ projectId: firstProjectId }]);
      expect(result.reports[0]).toMatchObject({ incomplete: true, truncated: true });
    } finally {
      now.mockRestore();
    }
  });
});
