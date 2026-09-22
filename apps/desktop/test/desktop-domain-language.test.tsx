import { setUiLanguage } from '@gosu/ui/language';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardView } from '../src/renderer/src/board-view';
import { boardColumnDisplayLabel } from '../src/renderer/src/domain-ui-labels';
import { lectureStudioStatusLabel } from '../src/renderer/src/lecture-studio-view';
import {
  formatUsageCoverage,
  formatUsageRange,
  usagePeriodLabel,
} from '../src/renderer/src/usage-view-model';
import { SearchView } from '../src/renderer/src/search-view';
import { ObjectiveEditor, WorkspacePageHeading } from '../src/renderer/src/workspace-views';
import { AiDefaultSettings } from '../src/renderer/src/ai-default-settings';
import type { ProjectRecord, WorkspaceTask } from '../src/shared/workspace-contracts';

const project: ProjectRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Search',
  slug: 'search',
  version: 1,
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
};

afterEach(() => setUiLanguage('en'));

describe('Desktop domain UI language', () => {
  it('localizes computed counts, date ranges, and generation statuses without changing values', () => {
    setUiLanguage('ko');
    expect(formatUsageCoverage(3, 5)).toBe('전체 5회 중 3회 응답');
    expect(usagePeriodLabel('month')).toBe('이번 달');
    expect(formatUsageRange('2026-09-08T00:00:00Z', '2026-09-09T00:00:00Z', 'UTC')).toContain(
      '9월',
    );
    expect(lectureStudioStatusLabel('generating')).toBe('생성 중');
    setUiLanguage('en');
    expect(formatUsageCoverage(3, 5)).toBe('3 of 5 turns');
    expect(lectureStudioStatusLabel('generating')).toBe('Generating');
  });
  it('localizes built-in workflow labels without rewriting a custom column name', () => {
    setUiLanguage('ko');
    expect(boardColumnDisplayLabel('backlog', 'Backlog')).toBe('대기 목록');
    expect(boardColumnDisplayLabel('backlog', 'Search')).toBe('Search');
    setUiLanguage('en');
    expect(boardColumnDisplayLabel('backlog', 'Backlog')).toBe('Backlog');
  });
  it('translates workspace navigation while retaining a project name that matches a UI key', () => {
    setUiLanguage('ko');
    const html = renderToStaticMarkup(
      <WorkspacePageHeading
        activeTab="experiments"
        activeProject={project}
        onNewProject={vi.fn()}
      />,
    );
    expect(html).toContain('Search / 실험');
    expect(html).toContain('<h1>실험</h1>');
    expect(html).toContain('＋ 새 프로젝트');
    expect(html).not.toContain('<h1>Experiments</h1>');
  });

  it('translates board controls but never task title, description, or custom column content', () => {
    const task: WorkspaceTask = {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: project.id,
      title: 'Save',
      description: 'Search',
      status: 'backlog',
      version: 1,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    setUiLanguage('ko');
    const html = renderToStaticMarkup(
      <BoardView
        project={project}
        tasks={[task]}
        busyAction={null}
        onCreateTask={vi.fn()}
        onUpdateTask={vi.fn()}
        onUpdateBoardSettings={vi.fn()}
        onSetTaskArchived={vi.fn()}
      />,
    );
    expect(html).toContain('열 이름 및 설정 변경');
    expect(html).toContain('작업 추가');
    expect(html).toContain('모든 우선순위');
    expect(html).toContain('<h3>Save</h3>');
    expect(html).toContain('<p class="task-description">Search</p>');
    expect(html).toContain('aria-label="Save 수정"');
  });

  it('changes search chrome in both directions without rewriting a query', () => {
    const props = {
      adapter: { search: vi.fn() },
      scope: { kind: 'global' } as const,
      scopeLabel: 'Search',
      initialQuery: 'Save',
      onOpen: vi.fn(),
    };
    setUiLanguage('ko');
    const korean = renderToStaticMarkup(<SearchView {...props} />);
    expect(korean).toContain('aria-label="작업 공간 검색"');
    expect(korean).toContain('키워드, 논문, 지표, 작업 또는 파일');
    expect(korean).toContain('value="Save"');
    expect(korean).toContain('Search 검색');
    setUiLanguage('en');
    const english = renderToStaticMarkup(<SearchView {...props} />);
    expect(english).toContain('aria-label="Workspace search"');
    expect(english).toContain('Keyword, paper, metric, task, or file');
    expect(english).toContain('value="Save"');
  });

  it('translates objective forms and AI configuration labels', () => {
    setUiLanguage('ko');
    const objective = renderToStaticMarkup(
      <ObjectiveEditor
        project={project}
        objective={undefined}
        busy={false}
        onSave={vi.fn()}
        onLock={vi.fn()}
        onStartVersion={vi.fn()}
      />,
    );
    expect(objective).toContain('연구 목표');
    expect(objective).toContain('기본 지표');
    expect(objective).toContain('실험 예산');
    expect(objective).toContain('목표 저장');
    const ai = renderToStaticMarkup(
      <AiDefaultSettings
        selection={{ providerId: 'codex', modelId: null, reasoningOptionId: null }}
        models={[]}
        modelsLoading={false}
        onRefreshModels={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(ai).toContain('프로젝트 채팅 기본 모델 및 reasoning 선택');
    expect(ai).toContain('모델 새로고침');
    expect(ai).toContain('기본값 저장');
  });
});
