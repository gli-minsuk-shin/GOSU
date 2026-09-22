import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { ProjectChatView } from '../src/renderer/src/project-chat-view';
import { defaultProjectChatProfile } from '../src/shared/project-chat-contracts';
import { expect, it, vi } from 'vitest';
import { parseModelLabChatHandoff } from '../src/renderer/src/project-model-lab-view';
import { ModelReferenceActions } from '../../model-lab/src/model-reference-actions';
import {
  CreateProjectChatSessionInputSchema,
  ProjectChatSessionSchema,
} from '../src/shared/project-chat-contracts';
const id = '11111111-1111-4111-8111-111111111111';
const selection = { modelId: 'model', revision: 3 };
it('shows the exact model name/revision chip and model-specific questions in Project Chat', () => {
  const now = '2026-09-14T00:00:00Z';
  const project = {
    id,
    name: 'Fixture project',
    slug: 'fixture',
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const html = renderToStaticMarkup(
    <ProjectChatView
      project={project}
      tasks={[]}
      snapshot={{
        schemaVersion: 1,
        projectId: id,
        session: {
          id,
          projectId: id,
          title: 'Model A',
          isDefault: false,
          modelLabReference: {
            ...selection,
            name: 'Exact Model A',
            version: 'v1',
            contentSha256: 'a'.repeat(64),
          },
          createdAt: now,
          updatedAt: now,
        },
        messages: [],
        attempts: [],
        profile: defaultProjectChatProfile(id),
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
      onSend={async () => false}
      onCancel={vi.fn()}
      onApplyAction={async () => undefined}
      chatDetailsCollapsed
    />,
  );
  expect(html).toContain('project-model-reference-tag');
  expect(html).toContain('Exact Model A');
  expect(html).toContain('r3');
  expect(html).toContain('Explain the referenced model architecture');
  expect(html).toContain('Ask about the referenced model');
  expect(html).not.toContain('다음으로 할 연구 작업 3개');
});
it('accepts only the exact iframe source and origin, never a sender-supplied project or model content', () => {
  const frame = {} as Window;
  const url = `http://127.0.0.1:5555/s/${'a'.repeat(64)}/${id}/`;
  const event = {
    source: frame,
    origin: 'http://127.0.0.1:5555',
    data: { type: 'gosu:model-lab:project-chat', model: selection },
  };
  expect(parseModelLabChatHandoff(event, frame, url)).toEqual(selection);
  expect(
    parseModelLabChatHandoff({ ...event, origin: 'https://example.com' }, frame, url),
  ).toBeNull();
  expect(parseModelLabChatHandoff({ ...event, source: {} as Window }, frame, url)).toBeNull();
  expect(
    parseModelLabChatHandoff({ ...event, data: { ...event.data, projectId: id } }, frame, url),
  ).toBeNull();
  expect(
    parseModelLabChatHandoff(
      { ...event, data: { ...event.data, model: { ...selection, content: 'injected' } } },
      frame,
      url,
    ),
  ).toBeNull();
});
it('shows one unambiguous Model Copilot action and never dispatches during render', () => {
  const onLocal = vi.fn();
  const html = renderToStaticMarkup(<ModelReferenceActions name="Model A" onLocal={onLocal} />);
  expect(html).toContain('Model A · Ask in Model Assistant');
  expect(html).toContain('AI conversation');
  expect(html).not.toContain('Ask in Project Chat');
  expect(onLocal).not.toHaveBeenCalled();
});
it('routes AI conversation to local model context while keeping explicit Project Chat access separate', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const onLocal = vi.fn();
  let view: ReturnType<typeof create> | undefined;
  try {
    await act(() => {
      view = create(<ModelReferenceActions name="Model A" onLocal={onLocal} />);
    });
    expect(view!.root.findAllByType('button')).toHaveLength(1);
    await act(() => view!.root.findByType('button').props.onClick());
    expect(onLocal).toHaveBeenCalledOnce();
    await act(() =>
      view!.update(<ModelReferenceActions name="Model A" onLocal={onLocal} disabled />),
    );
    expect(view!.root.findByType('button').props.disabled).toBe(true);
    const source = readFileSync(
      new URL('../../model-lab/src/model-lab-app.tsx', import.meta.url),
      'utf8',
    );
    expect(source).toContain('onLocal={() => openModelDiscussion(candidate.id)}');
    expect(source).toContain('onLocal={() => openModelDiscussion(model.id)}');
    const open = source.slice(
      source.indexOf('const openModelDiscussion'),
      source.indexOf('const openProjectDiscussion'),
    );
    expect(open).toContain('setModelId(id)');
    expect(open).toContain('setCopilotCollapsed(false)');
    expect(open).toContain('setModelChatFocusRequest');
    expect(open).not.toContain('postMessage');
    expect(source).toContain('className="model-reference-tag"');
    expect(source).toContain('englishGraphName(model.name, model.id)');
    expect(source).toContain('· r{modelRevision}');
    expect(source).toContain("type: 'gosu:model-lab:project-chat'");
  } finally {
    await act(() => view?.unmount());
    vi.unstubAllGlobals();
  }
});
it('accepts only a model selection on creation, preserving the server-owned hash/name on stored sessions', () => {
  expect(
    CreateProjectChatSessionInputSchema.parse({ projectId: id, modelLabSelection: selection })
      .modelLabSelection,
  ).toEqual(selection);
  expect(
    CreateProjectChatSessionInputSchema.safeParse({
      projectId: id,
      modelLabReference: { ...selection, name: 'spoofed' },
    }).success,
  ).toBe(false);
  const session = {
    id,
    projectId: id,
    title: 'Model A',
    isDefault: false,
    createdAt: '2026-09-14T00:00:00Z',
    updatedAt: '2026-09-14T00:00:00Z',
    modelLabReference: {
      ...selection,
      name: 'Model A',
      version: 'v1',
      contentSha256: 'a'.repeat(64),
    },
  };
  expect(ProjectChatSessionSchema.parse(session).modelLabReference).toEqual(
    session.modelLabReference,
  );
});
