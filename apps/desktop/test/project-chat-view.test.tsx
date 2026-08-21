import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ProjectChatView,
  projectChatPolicyRuleSnapshotCount,
  projectChatTodoSkillSuggestions,
  reconcileProjectChatSessionUiState,
  resolveProjectChatBranchActionState,
  resolveEditedMessageBranchPoint,
  resolveFailedTurnRecoveryMode,
  resolveEffectiveCodexModel,
  resolveInitialProjectChatScrollTop,
  resolveLatestMessageScrollTop,
  resolveProjectChatScrollIntent,
  resolveUnreadAssistantMessageId,
  shouldAcceptAttachmentPickerResult,
  shouldInitializeProjectChatScroll,
  shouldPersistProjectChatScrollPosition,
} from '../src/renderer/src/project-chat-view';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';
import type { SshServerResourceSnapshot } from '../src/shared/ssh-contracts';
import { describeError } from '../src/renderer/src/ui-primitives';
import {
  isProjectChatNearBottom,
  resolveProjectChatArrival,
} from '../src/renderer/src/project-chat-scroll';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Agentic study',
  slug: 'agentic-study',
  version: 1,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
} as const;

const linkedServerSnapshot: SshServerResourceSnapshot = {
  schemaVersion: 1,
  connectionId: '99999999-9999-4999-8999-999999999999',
  capturedAt: '2026-08-06T01:02:03.000Z',
  status: 'ready',
  cpu: { state: 'available', utilizationPercent: 63, logicalProcessorCount: 64 },
  memory: {
    state: 'available',
    usedBytes: 32 * 1024 ** 3,
    totalBytes: 128 * 1024 ** 3,
    utilizationPercent: 25,
  },
  gpu: {
    state: 'available',
    devices: [
      {
        index: 0,
        name: 'RTX fixture',
        utilizationPercent: 81,
        memoryUsedBytes: 8 * 1024 ** 3,
        memoryTotalBytes: 24 * 1024 ** 3,
        temperatureC: 69,
      },
    ],
  },
  issues: [],
};

describe('advanced Project Chat controls', () => {
  it('shows the project-rule count frozen into an individual turn without claiming semantic use', () => {
    expect(projectChatPolicyRuleSnapshotCount({ assemblyVersion: 4, policyRuleCount: 1 })).toBe(1);
    expect(projectChatPolicyRuleSnapshotCount({ assemblyVersion: 3 })).toBe(0);
    expect(projectChatPolicyRuleSnapshotCount(undefined)).toBe(0);

    const source = readFileSync(
      new URL('../src/renderer/src/project-chat-view.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('Project rules snapshot ${policyRuleSnapshotCount}');
    expect(source).not.toContain('Project rules applied ${policyRuleSnapshotCount}');
  });

  it('surfaces the project-wide rule list from the Project Chat toolbar', () => {
    const profile = {
      ...defaultProjectChatProfile(project.id),
      policyRules: ['Separate measured results from estimates.', 'State uncertainty explicitly.'],
    };
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile,
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
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onUpdatePolicyRules={vi.fn(async () => true)}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('Project rules (2)');
    expect(html).toContain('aria-expanded="false"');
  });

  it('shows the verified Hermes ACP boundary and disables unbridged attachments', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
        }}
        loading={false}
        inFlight={true}
        models={[
          {
            providerId: 'hermes',
            modelId: 'hermes-configured-model',
            displayName: 'Hermes configured model',
            isDefault: false,
            modalities: ['text'],
            reasoningOptions: [{ id: 'high', label: 'high', isDefault: true }],
            supportsPersonality: false,
          },
        ]}
        collaborationModes={[]}
        selectedProviderId="hermes"
        selectedModel="hermes-configured-model"
        selectedReasoning="high"
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('Hermes configured model');
    expect(html).not.toContain('Hermes · Hermes ·');
    expect(html).toContain('Hermes · verified ACP agent mode');
    expect(html).not.toContain('web_search');
    expect(html).not.toContain('web_extract');
    expect(html).not.toContain('delegate_task');
    expect(html).toContain('project-scoped file read and search tools');
    expect(html).toContain('Writes, terminal, code execution, web, browser automation');
    expect(html).toContain('Hermes turn active');
    expect(html).toContain('Stop &amp; send');
    expect(html).toContain('선택된 Hermes ACP agent가 활용합니다');
    expect(html).toMatch(
      /disabled=""[^>]*aria-label="Turn attachments are not yet bridged to Hermes"[^>]*aria-describedby=/u,
    );
    expect(html).toContain(
      'Turn attachments are not bridged to Hermes ACP yet; choose Codex to attach files',
    );
    expect(html).not.toContain('>Authorize…<');
    expect(html).not.toContain('>Enable automatic saves…<');
  });

  it('keeps the Hermes safety boundary visible and accessible when chat details are collapsed', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
        }}
        loading={false}
        inFlight={false}
        models={[
          {
            providerId: 'hermes',
            modelId: 'hermes-configured-model',
            displayName: 'Hermes configured model',
            isDefault: false,
            modalities: ['text'],
            reasoningOptions: [],
            supportsPersonality: false,
          },
        ]}
        collaborationModes={[]}
        selectedProviderId="hermes"
        selectedModel="hermes-configured-model"
        selectedReasoning={null}
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        chatDetailsCollapsed
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('Hermes ACP · project read tools');
    expect(html).toContain(
      'Hermes runs through a pinned, verified ACP agent with project-scoped read and search tools.',
    );
    expect(html).toMatch(
      /aria-label="Turn attachments are not yet bridged to Hermes"[^>]*aria-describedby=/u,
    );
  });

  it('uses provider-neutral copy when an explicit model disappears from the live catalog', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
        }}
        loading={false}
        inFlight={false}
        models={[]}
        collaborationModes={[]}
        selectedProviderId="hermes"
        selectedModel="temporarily-missing-provider-model"
        selectedReasoning={null}
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('no longer in the live Project Chat catalog');
    expect(html).not.toContain('no longer in the live Codex catalog');
    expect(html).toContain('Hermes · verified ACP agent mode');
    expect(html).toContain('Turn attachments are not yet bridged to Hermes');
  });

  it('shows the /todo skill only while its slash command is being entered', () => {
    expect(projectChatTodoSkillSuggestions('/')).toHaveLength(4);
    expect(projectChatTodoSkillSuggestions('/to')).toHaveLength(4);
    expect(projectChatTodoSkillSuggestions('/todo')).toHaveLength(4);
    expect(projectChatTodoSkillSuggestions('/todo list')).toEqual([]);
    expect(projectChatTodoSkillSuggestions('/unknown')).toEqual([]);
    expect(projectChatTodoSkillSuggestions('add a task')).toEqual([]);
  });

  it('keeps provenance and history actions in one compact accessible message footer', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [
            {
              id: '22222222-2222-4222-8222-222222222220',
              projectId: project.id,
              role: 'user',
              content: 'Revise this idea.',
              status: 'complete',
              model: {
                invocationId: '22222222-2222-4222-8222-222222222221',
                providerId: 'codex',
                requestedModelId: 'fixture-model',
                resolvedModelId: 'fixture-model',
                catalogVersion: 'fixture-catalog',
                reasoningOptionId: 'high',
              },
              actions: [],
              createdAt: '2026-08-04T00:00:00.000Z',
              completedAt: '2026-08-04T00:00:01.000Z',
            },
            {
              id: '22222222-2222-4222-8222-222222222222',
              projectId: project.id,
              role: 'assistant',
              content: 'Here is the revision.',
              status: 'complete',
              actions: [],
              createdAt: '2026-08-04T00:00:02.000Z',
              completedAt: '2026-08-04T00:00:03.000Z',
            },
          ],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
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
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html.match(/class="chat-message-meta"/gu)).toHaveLength(2);
    expect(html.match(/aria-label="Message history actions"/gu)).toHaveLength(2);
    expect(html).toContain('class="message-provenance"');
    expect(html).toMatch(
      /<footer class="chat-message-meta"><div class="message-provenance">.*?<\/div><div class="chat-message-branch"/u,
    );
    expect(html).toMatch(
      /Here is the revision\.<\/p><\/div><footer class="chat-message-meta"><div class="chat-message-branch"/u,
    );
    expect(html).toContain('aria-label="Edit this message in a new chat branch"');
    expect(html).toContain('aria-label="Create a new chat branch from this message"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="false"');
    expect(html.match(/✎ Edit &amp; branch/gu)).toHaveLength(1);
    expect(html.match(/⑂ Branch/gu)).toHaveLength(2);
    expect(resolveProjectChatBranchActionState(false)).toEqual({
      label: '⑂ Branch',
      accessibleLabel: 'Create a new chat branch from this message',
      busy: false,
    });
    expect(resolveProjectChatBranchActionState(true)).toEqual({
      label: 'Creating…',
      accessibleLabel: 'Creating chat branch…',
      busy: true,
    });
  });

  it('keeps message history controls dense while preserving touch targets', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
    const metaRule = styles.match(/\.chat-message-meta\s*\{(?<body>[^}]*)\}/u)?.groups?.body;
    const branchButtonRule = styles.match(/\.chat-message-branch button\s*\{(?<body>[^}]*)\}/u)
      ?.groups?.body;

    expect(metaRule).toBeDefined();
    expect(metaRule).toContain('display: flex');
    expect(metaRule).toContain('flex-wrap: wrap');
    expect(metaRule).not.toContain('padding-top');
    expect(metaRule).not.toContain('border-top');
    expect(branchButtonRule).toContain('min-height: 24px');
    expect(branchButtonRule).toContain('white-space: nowrap');
    expect(styles).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.chat-message-branch button\s*\{[^}]*min-height:\s*44px;/su,
    );
  });

  it('shows the full proposed task description inside a bounded review region', () => {
    const messageId = '22222222-2222-4222-8222-222222222222';
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [
            {
              id: messageId,
              projectId: project.id,
              role: 'assistant',
              content: 'Review this task before applying it.',
              status: 'complete',
              actions: [
                {
                  id: '33333333-3333-4333-8333-333333333333',
                  projectId: project.id,
                  messageId,
                  command: {
                    type: 'task.create',
                    title: 'Run controlled ablation',
                    status: 'planned',
                    description:
                      'Compare every controlled variant.\nRecord the metric and seed lineage.',
                    priority: 'high',
                    dueDate: '2026-08-14',
                    labels: ['ablation'],
                  },
                  status: 'proposed',
                  createdAt: '2026-08-04T00:00:01.000Z',
                  updatedAt: '2026-08-04T00:00:01.000Z',
                },
              ],
              createdAt: '2026-08-04T00:00:00.000Z',
              completedAt: '2026-08-04T00:00:01.000Z',
            },
          ],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
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
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('class="chat-action-description"');
    expect(html).toContain('Proposed description');
    expect(html).toContain(
      'Compare every controlled variant.\nRecord the metric and seed lineage.',
    );
    expect(html).toContain('Priority high');
  });

  it('describes bounded attachment failures without exposing local details', () => {
    expect(describeError(new Error('attachment_too_large'))).toContain('20 MB');
    expect(describeError(new Error('attachment_total_too_large'))).toContain('50 MB');
    expect(describeError(new Error('attachment_too_many'))).toContain('five files');
    expect(describeError(new Error('attachment_capacity_exhausted'))).toContain(
      'already waiting or being analyzed',
    );
    expect(describeError(new Error('attachment_encrypted'))).toContain('Password-protected');
    expect(describeError(new Error('attachment_model_modality_unsupported'))).toContain(
      'image-capable model',
    );
    expect(describeError(new Error('attachment_scope_mismatch'))).not.toContain('/Users/');
    expect(describeError(new Error('ssh_workspace_command_not_allowed'))).toContain(
      'relative Python experiment entrypoint',
    );
    expect(describeError(new Error('research_notes_folder_conflict'))).toContain(
      'cannot be safely replaced',
    );
    expect(describeError(new Error('research_notes_note_not_found'))).not.toContain('/Users/');
  });

  it('discards an attachment picker result after session change, replacement, or unmount', () => {
    expect(
      shouldAcceptAttachmentPickerResult(true, 'project-a/session-a', 'project-a/session-a', 2, 2),
    ).toBe(true);
    expect(
      shouldAcceptAttachmentPickerResult(true, 'project-a/session-a', 'project-a/session-b', 2, 2),
    ).toBe(false);
    expect(
      shouldAcceptAttachmentPickerResult(true, 'project-a/session-a', 'project-a/session-a', 2, 3),
    ).toBe(false);
    expect(
      shouldAcceptAttachmentPickerResult(false, 'project-a/session-a', 'project-a/session-a', 2, 2),
    ).toBe(false);
  });

  it('requires a fresh image attachment instead of offering an incomplete saved retry', () => {
    expect(resolveFailedTurnRecoveryMode('attachment_model_modality_unsupported')).toBe('reattach');
    expect(resolveFailedTurnRecoveryMode('codex_unavailable')).toBe('retry');
  });

  it('branches a historical edit before the original user message instead of mutating it', () => {
    const messages = [
      { id: 'assistant-before', role: 'assistant' as const, status: 'complete' as const },
      { id: 'user-original', role: 'user' as const, status: 'complete' as const },
      { id: 'assistant-after', role: 'assistant' as const, status: 'complete' as const },
    ];
    expect(resolveEditedMessageBranchPoint(messages, 'user-original')).toBe('assistant-before');
    expect(resolveEditedMessageBranchPoint(messages.slice(1), 'user-original')).toBeNull();
    expect(resolveEditedMessageBranchPoint(messages, 'missing')).toBeUndefined();
  });

  it('anchors a tall latest response below the transcript inset instead of clipping its header', () => {
    expect(
      resolveLatestMessageScrollTop({
        currentScrollTop: 600,
        scrollHeight: 1_600,
        clientHeight: 600,
        transcriptTop: 200,
        messageTop: 150,
        topInset: 18,
      }),
    ).toBe(532);

    expect(
      resolveLatestMessageScrollTop({
        currentScrollTop: 0,
        scrollHeight: 1_000,
        clientHeight: 600,
        transcriptTop: 100,
        messageTop: 980,
        topInset: 18,
      }),
    ).toBe(400);
  });

  it('restores a saved session position or opens unseen history directly at the bottom', () => {
    expect(
      resolveInitialProjectChatScrollTop({
        savedScrollTop: null,
        scrollHeight: 1_600,
        clientHeight: 600,
      }),
    ).toBe(1_000);
    expect(
      resolveInitialProjectChatScrollTop({
        savedScrollTop: 640,
        scrollHeight: 1_600,
        clientHeight: 600,
      }),
    ).toBe(640);
    expect(
      resolveInitialProjectChatScrollTop({
        savedScrollTop: 2_000,
        scrollHeight: 1_600,
        clientHeight: 600,
      }),
    ).toBe(1_000);
    expect(
      resolveInitialProjectChatScrollTop({
        savedScrollTop: 120,
        scrollHeight: 400,
        clientHeight: 600,
      }),
    ).toBe(0);
  });

  it('does not animate programmatic transcript restoration through old history', () => {
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');
    const transcriptRule = styles.match(/(?:^|\n)\.chat-transcript\s*\{(?<body>[^}]*)\}/u)?.groups
      ?.body;

    expect(transcriptRule).toBeDefined();
    expect(transcriptRule).not.toContain('scroll-behavior: smooth');
  });

  it('shows latest controls only after the reader leaves the transcript bottom threshold', () => {
    expect(isProjectChatNearBottom(900, 1_600, 600)).toBe(false);
    expect(isProjectChatNearBottom(910, 1_600, 600)).toBe(true);
    expect(isProjectChatNearBottom(1_000, 1_600, 600)).toBe(true);
    expect(isProjectChatNearBottom(0, 400, 600)).toBe(true);
  });

  it('preserves a reader position and announces assistant arrivals away from the bottom', () => {
    expect(
      resolveProjectChatArrival({
        nearBottom: false,
        latestRole: 'assistant',
        latestMessageIdChanged: true,
        latestContentChanged: true,
      }),
    ).toEqual({ intent: 'none', announceNewAssistantMessage: true });

    expect(
      resolveProjectChatArrival({
        nearBottom: false,
        latestRole: 'assistant',
        latestMessageIdChanged: false,
        latestContentChanged: true,
      }),
    ).toEqual({ intent: 'none', announceNewAssistantMessage: true });
  });

  it('follows assistant output only when the reader was already near the bottom', () => {
    expect(
      resolveProjectChatArrival({
        nearBottom: true,
        latestRole: 'assistant',
        latestMessageIdChanged: true,
        latestContentChanged: true,
      }),
    ).toEqual({ intent: 'latest-start', announceNewAssistantMessage: false });

    expect(
      resolveProjectChatArrival({
        nearBottom: true,
        latestRole: 'assistant',
        latestMessageIdChanged: false,
        latestContentChanged: true,
      }),
    ).toEqual({ intent: 'bottom', announceNewAssistantMessage: false });
  });

  it("does not announce the reader's own message or unchanged content as a new response", () => {
    expect(
      resolveProjectChatArrival({
        nearBottom: false,
        latestRole: 'user',
        latestMessageIdChanged: true,
        latestContentChanged: true,
      }),
    ).toEqual({ intent: 'none', announceNewAssistantMessage: false });
    expect(
      resolveProjectChatArrival({
        nearBottom: false,
        latestRole: 'assistant',
        latestMessageIdChanged: false,
        latestContentChanged: false,
      }),
    ).toEqual({ intent: 'none', announceNewAssistantMessage: false });
  });

  it('targets the unread assistant response even when a user message follows it', () => {
    const messages = [
      { id: 'assistant-unread', role: 'assistant' },
      { id: 'user-later', role: 'user' },
    ] as const;

    expect(resolveUnreadAssistantMessageId(messages, 'assistant-unread')).toBe('assistant-unread');
    expect(resolveUnreadAssistantMessageId(messages, 'user-later')).toBeNull();
    expect(resolveUnreadAssistantMessageId(messages, 'missing-assistant')).toBeNull();
  });

  it('marks the exact searched message as the transcript navigation target', () => {
    const messageId = '44444444-4444-4444-8444-444444444444';
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [
            {
              id: messageId,
              projectId: project.id,
              role: 'assistant',
              content: 'Exact searched evidence',
              status: 'complete',
              actions: [],
              createdAt: '2026-08-04T00:00:00.000Z',
              completedAt: '2026-08-04T00:00:01.000Z',
            },
          ],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
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
        searchTarget={{ requestId: 3, targetId: messageId }}
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toMatch(/class="chat-message assistant complete search-target"/u);
    expect(html).toContain('Exact searched evidence');
  });

  it('does not save a loading placeholder as a real session position', () => {
    const sessionKey = `${project.id}\u0000session-a`;
    expect(shouldPersistProjectChatScrollPosition(null, sessionKey)).toBe(false);
    expect(shouldPersistProjectChatScrollPosition(`${project.id}\u0000session-b`, sessionKey)).toBe(
      false,
    );
    expect(shouldPersistProjectChatScrollPosition(sessionKey, sessionKey)).toBe(true);
    expect(shouldInitializeProjectChatScroll(true, false)).toBe(false);
    expect(shouldInitializeProjectChatScroll(false, false)).toBe(false);
    expect(shouldInitializeProjectChatScroll(false, true)).toBe(true);
  });

  it('waits for the terminal assistant snapshot before moving away from the active turn bottom', () => {
    expect(
      resolveProjectChatScrollIntent({
        observedLatestMessageId: null,
        latestMessageId: 'saved-assistant',
        wasInFlight: false,
        inFlight: false,
      }),
    ).toBe('latest-start');
    expect(
      resolveProjectChatScrollIntent({
        observedLatestMessageId: 'new-user-message',
        latestMessageId: 'new-user-message',
        wasInFlight: true,
        inFlight: false,
      }),
    ).toBe('none');
    expect(
      resolveProjectChatScrollIntent({
        observedLatestMessageId: 'new-user-message',
        latestMessageId: 'terminal-assistant-message',
        wasInFlight: false,
        inFlight: false,
      }),
    ).toBe('latest-start');
    expect(
      resolveProjectChatScrollIntent({
        observedLatestMessageId: 'terminal-assistant-message',
        latestMessageId: 'terminal-assistant-message',
        wasInFlight: false,
        inFlight: true,
      }),
    ).toBe('bottom');
  });

  it('preserves typed draft, retry, and Advanced state for the same project session', () => {
    const current = {
      draft: 'typed while changing the model',
      retryOfAttemptId: 'retry-attempt-1',
      advancedOpen: true,
    } as const;

    const reconciled = reconcileProjectChatSessionUiState(
      `${project.id}\u0000session-a`,
      `${project.id}\u0000session-a`,
      current,
      'parent rerender supplied a changed initial draft',
    );

    expect(reconciled).toBe(current);
    expect(reconciled).toEqual(current);
  });

  it('hydrates the draft and resets retry and Advanced only for a new project-session identity', () => {
    expect(
      reconcileProjectChatSessionUiState(
        `${project.id}\u0000session-a`,
        `${project.id}\u0000session-b`,
        {
          draft: 'session A draft',
          retryOfAttemptId: 'retry-attempt-1',
          advancedOpen: true,
        },
        'session B saved draft',
      ),
    ).toEqual({
      draft: 'session B saved draft',
      retryOfAttemptId: null,
      advancedOpen: false,
    });
  });

  it('resolves Auto through the selected native mode before the provider default', () => {
    const models = [
      {
        modelId: 'provider-default',
        displayName: 'Provider default',
        isDefault: true,
        reasoningOptions: [{ id: 'low', label: 'Low', isDefault: true }],
      },
      {
        modelId: 'mode-recommended',
        displayName: 'Mode recommended',
        isDefault: false,
        reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
        supportsPersonality: true,
      },
    ];
    const modes = [
      {
        id: 'future-mode',
        displayName: 'Future mode',
        recommendedModelId: 'mode-recommended',
        recommendedReasoningOptionId: 'high',
      },
    ];

    expect(resolveEffectiveCodexModel(models, modes, null, null, 'future-mode')?.modelId).toBe(
      'mode-recommended',
    );
    expect(
      resolveEffectiveCodexModel(models, modes, 'codex', 'provider-default', 'future-mode')
        ?.modelId,
    ).toBe('provider-default');
  });

  it('keeps explicit provider provenance when model ids collide', () => {
    const models = [
      {
        providerId: 'codex',
        modelId: 'shared-id',
        displayName: 'Codex model',
        isDefault: true,
        reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
      },
      {
        providerId: 'hermes',
        modelId: 'shared-id',
        displayName: 'Hermes model',
        isDefault: false,
        reasoningOptions: [{ id: 'high', label: 'High', isDefault: true }],
      },
    ];

    expect(resolveEffectiveCodexModel(models, [], 'codex', 'shared-id', null)?.displayName).toBe(
      'Codex model',
    );
    expect(resolveEffectiveCodexModel(models, [], 'hermes', 'shared-id', null)?.displayName).toBe(
      'Hermes model',
    );
    expect(resolveEffectiveCodexModel(models, [], 'future-provider', 'shared-id', null)).toBe(
      undefined,
    );
  });

  it('exposes dynamic reasoning separately from the bounded project harness', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
        }}
        loading={false}
        inFlight={false}
        models={[
          {
            modelId: 'fixture-live-model',
            displayName: 'Fixture live model',
            isDefault: true,
            reasoningOptions: [{ id: 'provider-high', label: 'Provider high', isDefault: false }],
            supportsPersonality: true,
          },
        ]}
        collaborationModes={[
          {
            id: 'default',
            displayName: 'Default',
            recommendedModelId: null,
            recommendedReasoningOptionId: null,
          },
          {
            id: 'plan',
            displayName: 'Plan',
            recommendedModelId: null,
            recommendedReasoningOptionId: 'provider-high',
          },
          {
            id: 'auto',
            displayName: 'Provider Auto Mode',
            recommendedModelId: null,
            recommendedReasoningOptionId: null,
          },
        ]}
        selectedProviderId="codex"
        selectedModel="fixture-live-model"
        selectedReasoning="provider-high"
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
        initialAdvancedOpen
        sshAccess={{ state: 'ready', registeredConnectionCount: 1, grantedWorkspaceCount: 0 }}
        onOpenSshWorkspaceSetup={vi.fn()}
      />,
    );

    expect(html).toContain('Fixture live model');
    expect(html).toContain('Provider high');
    expect(html).toContain('Advanced agent controls');
    expect(html).toContain('Default');
    expect(html).toContain('Plan');
    expect(html).toContain('Provider Auto Mode');
    expect(html).toContain('<option value="" selected="">Auto · Codex default</option>');
    expect(html).toContain('<option value="auto">Provider Auto Mode</option>');
    expect(html).toContain('Native modes are discovered from the local Codex App Server');
    expect(html).toContain('Answer verbosity');
    expect(html).toContain('Personality');
    expect(html).toContain('Board + Objective');
    expect(html).toContain('Board / To-do + Objective read tools');
    expect(html).toContain('Research Notes not authorized');
    expect(html).toContain('Cached web');
    expect(html).toContain('Authorize…');
    expect(html).toContain('SSH requires Allow once');
    expect(html).toContain('SSH server registered — project access is not granted yet');
    expect(html).toContain('Grant to Agentic study…');
    expect(html).toContain('SSH workspace not granted');
    expect(html).toContain('foreground Python experiment entrypoints');
    expect(html).toContain('Experiments are limited to 120 seconds');
    expect(html).toContain('The direct GOSU tool surface does not offer raw shells');
    expect(html).toContain('can reach anything the SSH account permits');
    expect(html).toContain('aria-label="Attach research files"');
    expect(html).toContain(
      'Attach up to 5 documents, presentations, text files, or images for this turn',
    );
    expect(html).toContain('<span>Files</span>');
    expect(html).not.toContain('Attach PDF files');
    expect(html).toContain('Edit in Settings…');
  });

  it('collapses chat details into a critical summary without hiding the conversation controls', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
        }}
        loading={false}
        inFlight={false}
        projectBusy
        models={[
          {
            modelId: 'fixture-live-model',
            displayName: 'Fixture live model',
            isDefault: true,
            reasoningOptions: [{ id: 'provider-high', label: 'Provider high', isDefault: true }],
          },
        ]}
        collaborationModes={[]}
        selectedProviderId="codex"
        selectedModel="fixture-live-model"
        selectedReasoning="provider-high"
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
        initialAdvancedOpen
        chatDetailsCollapsed
        sessionRailCollapsed
        sshAccess={{ state: 'ready', registeredConnectionCount: 1, grantedWorkspaceCount: 0 }}
        onOpenSshWorkspaceSetup={vi.fn()}
      />,
    );

    expect(html).toContain('project-chat-workspace session-rail-collapsed');
    expect(html).toContain('chat-details-collapsed');
    expect(html).toContain('chat-toolbar collapsed');
    expect(html).toContain('Project Copilot');
    expect(html).toContain('Fixture live model');
    expect(html).toContain('Provider high');
    expect(html).toContain('SSH setup needed');
    expect(html).toContain('aria-label="Show chat details"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-label="Show chat details"[^>]*>Show details<\/button>/u);
    expect(html).not.toMatch(/aria-label="Show chat details"[^>]*disabled=""/u);
    expect(html).not.toContain('GOSU Project Copilot');
    expect(html).not.toContain('Linked server resources');
    expect(html).not.toContain('Refresh usage');
    expect(html).not.toContain('Advanced agent controls');
    expect(html).toContain('A project-wide chat update is finishing.');
    expect(html).toContain('aria-label="Attach research files"');
  });

  it('keeps one bounded chat-detail toggle node so long project names cannot hide keyboard restore', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/project-chat-view.tsx', import.meta.url),
      'utf8',
    );
    const styles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8');

    expect(source.match(/className="ghost-button chat-details-toggle"/gu)).toHaveLength(1);
    expect(source).toContain('onChatDetailsCollapsedChange(!chatDetailsCollapsed)');
    expect(styles).toMatch(
      /\.chat-toolbar-summary-identity\s*\{[^}]*flex:\s*0 1 220px;[^}]*max-width:\s*220px;[^}]*min-width:\s*0;/su,
    );
    expect(styles).toMatch(
      /\.chat-toolbar-actions\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/su,
    );
  });

  it('states the real remote security boundary before enabling trusted workspace access', () => {
    const source = readFileSync(
      new URL('../src/renderer/src/project-chat-view.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('SSH account’s OS and network permissions');
    expect(source).toContain('can spawn subprocesses');
    expect(source).toContain(
      'Typed path limits and the lack of a raw-shell UI do not make this a remote sandbox',
    );
    expect(source).toContain('The direct GOSU tool surface rejects raw shell');
    expect(source).toContain('Those input checks do not constrain code after launch');
    expect(source).toContain('read or change secrets and paths outside the grant');
    expect(source).toContain('start any subprocess the SSH account permits');
    expect(source).toContain('The direct GOSU tool surface does not offer raw shells');
    expect(source).toContain('can reach anything the SSH account permits');
    expect(source).toContain('secrets, out-of-grant paths, the network, and subprocesses');
    expect(source).not.toContain('GOSU still blocks raw shell, secrets and private keys');
  });

  it('shows only the project-scoped linked server resources in every chat session shell', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
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
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
        sshAccess={{ state: 'ready', registeredConnectionCount: 2, grantedWorkspaceCount: 1 }}
        sshServers={[
          {
            connectionId: linkedServerSnapshot.connectionId,
            grantId: '88888888-8888-4888-8888-888888888888',
            grantVersion: 1,
            label: 'Granted GPU server',
            canonicalRoot: '/workspace/agentic-study',
            permissionMode: 'workspace',
            trustedAccessEnabled: false,
            privilegeClass: 'standard',
            resourceState: { phase: 'ready', snapshot: linkedServerSnapshot },
          },
        ]}
        onRefreshSshResource={vi.fn()}
      />,
    );

    expect(html).toContain('Linked server resources');
    expect(html).toContain('Visible only to Agentic study');
    expect(html).toContain('Granted GPU server');
    expect(html).toContain('/workspace/agentic-study');
    expect(html).toContain('Live sample');
    expect(html).toContain('Show details');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('CPU utilization 63%');
    expect(html).not.toContain('GPU 0 utilization 81%');
    expect(html).toContain('Refresh usage');
    expect(html).toContain('Allow once required');
    expect(html).toContain('Enable auto-run…');
    expect(html).not.toContain('SSH server registered — project access is not granted yet');
  });

  it('offers project-scoped auto-run for an explicitly identified ROOT workspace', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
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
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
        sshAccess={{ state: 'ready', registeredConnectionCount: 1, grantedWorkspaceCount: 1 }}
        sshServers={[
          {
            connectionId: linkedServerSnapshot.connectionId,
            grantId: '88888888-8888-4888-8888-888888888888',
            grantVersion: 1,
            label: 'ROOT GPU server',
            canonicalRoot: '/root/agentic-study',
            permissionMode: 'workspace',
            trustedAccessEnabled: false,
            privilegeClass: 'root',
            resourceState: { phase: 'ready', snapshot: linkedServerSnapshot },
          },
        ]}
        onRefreshSshResource={vi.fn()}
      />,
    );

    expect(html).toContain('Enable ROOT auto-run…');
    expect(html).toContain('auto-run supported project operations as ROOT');
  });

  it('keeps the composer disabled until the default session finishes hydrating', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={null}
        loading
        inFlight={false}
        models={[]}
        collaborationModes={[]}
        selectedModel={null}
        selectedReasoning={null}
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('암호화된 프로젝트 대화를 불러오는 중…');
    expect(html).toMatch(/<textarea[^>]*disabled=""/u);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send/u);
  });

  it('hydrates the project-session draft owned by the stable Desktop shell', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
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
        initialDraft="restore this unsent session draft"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('restore this unsent session draft</textarea>');
  });

  it('lets another session send immediately while showing the active sibling session', () => {
    const selectedSession = {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: project.id,
      title: 'Selected chat',
      isDefault: true,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    } as const;
    const activeSiblingSession = {
      ...selectedSession,
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Running ablation',
      isDefault: false,
    } as const;
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          session: selectedSession,
          sessions: [selectedSession, activeSiblingSession],
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
        }}
        loading={false}
        inFlight={false}
        sessions={[selectedSession, activeSiblingSession]}
        selectedSessionId={selectedSession.id}
        activeSessionIds={new Set([activeSiblingSession.id])}
        models={[]}
        collaborationModes={[]}
        selectedModel={null}
        selectedReasoning={null}
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('Running ablation');
    expect(html).toContain('Turn active');
    expect(html).not.toContain('Another session has an active Codex turn.');
    expect(html).not.toContain('A project-wide chat update is finishing.');
    expect(html).not.toMatch(/<textarea[^>]*disabled=""/u);
    expect(html).toContain('>Send<span>Enter</span>');
    expect(html).not.toContain('>Stop</button>');
    expect(html).toContain('aria-label="Create a new project chat session"');
  });

  it('queues a message only when the selected session is already starting', () => {
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile: defaultProjectChatProfile(project.id),
        }}
        loading={false}
        inFlight={false}
        sessionBusy
        models={[]}
        collaborationModes={[]}
        selectedModel={null}
        selectedReasoning={null}
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('>Queue<span>Enter</span>');
    expect(html).not.toContain('>Stop</button>');
    expect(html).not.toContain('A project-wide chat update is finishing.');
  });

  it('shows a compact editable queue with a safe replace-current action', () => {
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          queuedTurns: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              projectId: project.id,
              sessionId,
              message: 'Analyze the queued experiment',
              requestedModelId: null,
              reasoningOptionId: null,
              priority: 'next',
              status: 'queued',
              createdAt: '2026-08-06T00:00:00.000Z',
              updatedAt: '2026-08-06T00:00:00.000Z',
            },
          ],
          profile: defaultProjectChatProfile(project.id),
        }}
        loading={false}
        inFlight
        models={[]}
        collaborationModes={[]}
        selectedModel={null}
        selectedReasoning={null}
        applyingActionId={null}
        vault={null}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('Queued · 1');
    expect(html).toContain('Analyze the queued experiment');
    expect(html).toContain('Runs next');
    expect(html).toContain('Stop current &amp; run now');
    expect(html).toContain('>Edit</button>');
    expect(html).toContain('>Remove</button>');
    expect(html).toContain('>Stop</button>');
    expect(html).toContain('aria-label="Stop the current Project Chat response"');
    expect(html).toContain('>Stop response</button>');
    expect(html).toContain('>Queue<span>Enter</span>');
  });

  it('pauses a saved Research Notes grant while Main-process capability status is unavailable', () => {
    const profile = {
      ...defaultProjectChatProfile(project.id),
      localNotesVault: { id: 'a'.repeat(64), name: 'Research Vault' },
    };
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile,
        }}
        loading={false}
        inFlight={false}
        models={[]}
        collaborationModes={[]}
        selectedModel={null}
        selectedReasoning={null}
        applyingActionId={null}
        vault={null}
        vaultState="unavailable"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('Research Notes status unavailable');
    expect(html).toContain('This turn is paused to prevent stale or cross-project note access.');
    expect(html).not.toContain('Authorize…');
  });

  it('pauses a saved Research Notes grant when another project binding is active', () => {
    const profile = {
      ...defaultProjectChatProfile(project.id),
      localNotesVault: { id: 'a'.repeat(64), name: 'Previous Research Notes' },
    };
    const html = renderToStaticMarkup(
      <ProjectChatView
        project={project}
        tasks={[]}
        snapshot={{
          schemaVersion: 1,
          projectId: project.id,
          messages: [],
          attempts: [],
          profile,
        }}
        loading={false}
        inFlight={false}
        models={[]}
        collaborationModes={[]}
        selectedModel={null}
        selectedReasoning={null}
        applyingActionId={null}
        vault={{
          id: 'b'.repeat(64),
          name: 'Current project Research Notes',
          root: 'Obsidian/GOSU/Current project',
          files: [],
        }}
        vaultState="ready"
        onSelectedModel={vi.fn()}
        onSelectedReasoning={vi.fn()}
        onRefreshModels={vi.fn()}
        onOpenAgentSettings={vi.fn()}
        onSend={vi.fn()}
        onCancel={vi.fn()}
        onApplyAction={vi.fn()}
      />,
    );

    expect(html).toContain('Previous Research Notes grant inactive');
    expect(html).toContain('This turn is paused to prevent stale or cross-project note access.');
    expect(html).toMatch(/<button[^>]*class="primary-button chat-send"[^>]*disabled=""/u);
    expect(html).toContain('Authorize…');
  });
});
