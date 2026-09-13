import { createRoot } from 'react-dom/client';
import { ProjectChatView } from '../../desktop/src/renderer/src/project-chat-view';
import '../../desktop/src/renderer/src/styles.css';
const now = '2026-09-13T00:00:00Z',
  projectId = '11111111-1111-4111-8111-111111111111';
const noop = () => undefined;
createRoot(document.getElementById('root')!).render(
  <div style={{ height: '100vh', padding: 12, boxSizing: 'border-box' }}>
    <ProjectChatView
      project={{
        id: projectId,
        name: 'Project Chat · 합성 검증',
        slug: 'synthetic',
        version: 1,
        createdAt: now,
        updatedAt: now,
      }}
      tasks={[]}
      snapshot={{
        schemaVersion: 1,
        projectId,
        contextUsage: {
          windowTokens: 1000000,
          windowSource: 'provider',
          estimatedInputTokens: 142000,
          outputReserveTokens: 64000,
          toolReserveTokens: 48000,
          totalMessages: 600,
          includedMessages: 180,
          compressedMessages: 420,
          omittedMessages: 0,
          native: {
            inputTokens: 180000,
            outputTokens: 2800,
            cachedInputTokens: 142000,
            reasoningTokens: 1700,
            totalTokens: 182800,
            contextTokens: 164800,
            contextWindowTokens: 828400,
          },
        },
        messages: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            projectId,
            role: 'assistant',
            content:
              '이 화면은 토큰 표시 검증용입니다. 실제 모델 호출은 없습니다.\n\n오래된 가정과 결정은 요약으로 유지하고, **정확한 수식과 코드**는 원본 대화에서 다시 확인합니다.',
            status: 'complete',
            actions: [],
            createdAt: now,
            completedAt: now,
          },
        ],
      }}
      loading={false}
      inFlight={false}
      models={[]}
      collaborationModes={[]}
      selectedModel={null}
      selectedReasoning={null}
      applyingActionId={null}
      vault={null}
      vaultState="ready"
      onSelectedModel={noop}
      onSelectedReasoning={noop}
      onRefreshModels={noop}
      onOpenAgentSettings={noop}
      onSend={async () => false}
      onCancel={noop}
      onApplyAction={noop}
      sessionRailCollapsed
      chatDetailsCollapsed
    />
  </div>,
);
