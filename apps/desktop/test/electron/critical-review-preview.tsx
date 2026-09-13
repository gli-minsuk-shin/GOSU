import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setUiLanguage } from '@gosu/ui/language';
import { CriticalReviewHeader } from '../../src/renderer/src/critical-review-header';
import { ProjectChatView } from '../../src/renderer/src/project-chat-view';
import {
  defaultProjectChatProfile,
  type ProjectChatSession,
} from '../../src/shared/project-chat-contracts';
import type { CriticalReviewMode } from '../../src/shared/critical-review';
import '../../src/renderer/src/styles.css';

setUiLanguage('ko');
const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Research fixture',
  slug: 'fixture',
  version: 1,
  createdAt: '2026-09-14T00:00:00Z',
  updatedAt: '2026-09-14T00:00:00Z',
};
const initial: ProjectChatSession[] = ['direction', 'manuscript'].map((mode, index) => ({
  id: `22222222-2222-4222-8222-22222222222${index}`,
  projectId: project.id,
  title: mode === 'direction' ? '핵심 주장과 검증 설계' : '제출 원고 검토',
  criticalReviewMode: mode as CriticalReviewMode,
  isDefault: false,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
}));
const noop = () => undefined;
function Preview() {
  const [mode, setMode] = useState<CriticalReviewMode>('direction');
  const [sessions, setSessions] = useState(initial);
  const [selected, setSelected] = useState(initial[0]!.id);
  const session = sessions.find((s) => s.id === selected)!;
  const create = () => {
    const next = {
      ...initial.find((s) => s.criticalReviewMode === mode)!,
      id: crypto.randomUUID(),
      title: `새 검토 ${sessions.length + 1}`,
    };
    setSessions([...sessions, next]);
    setSelected(next.id);
  };
  return (
    <main
      className="desktop-content desktop-content-chat desktop-content-review"
      style={{ height: '100vh' }}
    >
      <CriticalReviewHeader
        mode={mode}
        sessions={sessions}
        selectedSessionId={selected}
        busy={false}
        onMode={(next) => {
          setMode(next);
          setSelected(sessions.find((s) => s.criticalReviewMode === next)!.id);
        }}
        onSession={setSelected}
        onCreate={create}
      />
      <ProjectChatView
        key={session.id}
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          session,
          sessions: sessions.filter((s) => s.criticalReviewMode === mode),
          messages: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              projectId: project.id,
              role: 'assistant',
              status: 'complete',
              actions: [],
              content:
                '**검토 범위** · 합성 개요만 확인했습니다. 원고와 실험 결과는 제공되지 않았습니다.\n\n### 먼저 확인할 문제\n\n**핵심 주장과 비교 기준**을 분리하세요. 단일 데이터셋의 향상을 일반적 우월성으로 해석하기에는 근거가 부족합니다.\n\n- **근거:** 개요의 실험 계획\n- **중요도:** 주요 우려 · 확신 중간\n- **수정안:** 동일 예산의 기준 모델과 비교하고, 독립 데이터셋에서 효과의 방향을 검증하세요.\n\n이는 실제 논문 평가가 아닌 화면 검증용 예시입니다.',
              createdAt: project.createdAt,
              completedAt: project.createdAt,
            },
          ],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
        }}
        loading={false}
        inFlight={false}
        models={[
          {
            providerId: 'codex',
            modelId: 'fixture-model',
            displayName: 'Fixture model',
            isDefault: true,
            reasoningOptions: [{ id: 'high', label: 'high', isDefault: true }],
          },
        ]}
        collaborationModes={[]}
        selectedModel="fixture-model"
        selectedProviderId="codex"
        selectedReasoning="high"
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={noop}
        onSelectedReasoning={noop}
        onRefreshModels={noop}
        onOpenAgentSettings={noop}
        onSend={async () => false}
        onCancel={noop}
        onApplyAction={async () => undefined}
        chatDetailsCollapsed
        sessionRailCollapsed
        onSelectSession={setSelected}
        onCreateSession={create}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
