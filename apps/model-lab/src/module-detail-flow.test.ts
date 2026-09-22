import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { composeRepeatedBlocks, findGraphModule } from './model-graph';
import { chatMessageDisplay, ModuleDetailDialog, type ChatMessage } from './model-lab-app';
import { loadModelLabChats, saveModelLabChats } from './model-lab-chat-storage';
import type { ModelModule, ModelSpec } from './model-lab-schema';
import {
  legacyModuleQuestion,
  loopParentModule,
  moduleConversationBody,
  moduleDataFlow,
  moduleDetailNeighbors,
  moduleExplanationQuestion,
  moduleFollowUpQuestion,
  moduleQuestionRef,
  readModuleQuestionRef,
} from './module-detail-flow';
import {
  moduleExplanation,
  moduleExplanationKey,
  readModuleExplanations,
  withModuleExplanation,
} from './module-explanations';

const loop = [
  'for l in range(8):',
  '    film = FiLM(code)',
  '    q = q_proj(norm_b(B)) * exp(log_temp)',
  '    k = k_proj(norm_c(C))',
  '    s = joint_mix(feature_sim(A), latent_sim(q, k))',
  '    B = B + gamma_B * mix_b(s)',
  '    if l in 0..6:',
  '        z = axial(B, C, A)',
  '        B = B + z',
  '    C_final = C',
].join('\n');

const module = (id: string, overrides: Partial<ModelModule> = {}): ModelModule => ({
  id,
  name: id,
  kind: 'linear',
  group: id,
  stage: 0,
  lane: 0,
  inputShape: ['N', 'K'],
  outputShape: ['N', 'K'],
  transform: `${id} = f(x)`,
  activation: null,
  formula: 'y=x',
  explanation: `${id} notes`,
  parameterCount: 0,
  codeReference: 'test',
  ...overrides,
});

const model = (modules: ModelModule[], connections: [string, string, string][] = []) =>
  ({
    id: 'm',
    name: 'M',
    version: '1',
    framework: 'PyTorch',
    sourceLabel: 'test',
    sourceArtifacts: [],
    summary: '',
    intent: { statement: '', invariants: [], expectedInput: ['N'], expectedOutput: ['N'] },
    modules,
    connections: connections.map(([source, target, tensorName], index) => ({
      id: `e${index}`,
      source,
      target,
      tensorName,
      shape: ['N'],
      activationNorm: 0,
      gradient: {
        checkpoints: [1],
        healthy: [0],
        vanishing: [0],
        detached: [0],
        exploding: [0],
      },
      expectedToCarryGradient: true,
    })),
    gradientEvidence: null,
  }) as unknown as ModelSpec;

const topLevel = model([
  module('abcd', {
    name: 'ABCD block',
    transform: loop,
    explanation: '8 blocks share one structure; carry-over (2) per-head q/k projection.',
    formula: String.raw`q=W_q\,\mathrm{LN}(B)\cdot e^{\tau}`,
    repeat: { count: 8, label: 'ABCD block x8' },
  }),
]);
const loopGraph = composeRepeatedBlocks(topLevel, 'en').blocks[0]!.detailModel;
const step = (index: number) => loopGraph.modules[index]!;

describe('module detail navigation', () => {
  it('finds previous and next connected modules, once each, including branches', () => {
    const branching = model(
      [module('input'), module('condition'), module('block'), module('head')],
      [
        ['input', 'block', 'A'],
        ['condition', 'block', 'code'],
        ['input', 'block', 'y'],
        ['block', 'head', 'C_final'],
      ],
    );
    const neighbors = moduleDetailNeighbors(branching, 'block');
    expect(neighbors.previous.map((entry) => [entry.module.id, entry.tensorName])).toEqual([
      ['input', 'A'],
      ['condition', 'code'],
    ]);
    expect(neighbors.next.map((entry) => entry.module.id)).toEqual(['head']);
    expect(moduleDetailNeighbors(branching, 'input').previous).toEqual([]);
    // Loop steps follow the iteration order.
    expect(moduleDetailNeighbors(loopGraph, step(1).id).previous[0]!.module.id).toBe(step(0).id);
    expect(moduleDetailNeighbors(loopGraph, step(1).id).next[0]!.module.id).toBe(step(2).id);
  });
});

describe('module data flow', () => {
  it('traces loop values to the steps that write and read them', () => {
    const s = moduleDataFlow(loopGraph, step(3).id);
    expect(s.kind).toBe('variables');
    expect(s.incoming).toEqual([
      { value: 'A', moduleId: null, origin: 'block-input' },
      { value: 'q', moduleId: step(1).id, origin: 'step' },
      { value: 'k', moduleId: step(2).id, origin: 'step' },
    ]);
    expect(s.outgoing).toEqual([{ value: 's', moduleId: step(4).id, origin: 'step' }]);
    // B is read from the previous iteration's last update and goes to the later steps.
    const q = moduleDataFlow(loopGraph, step(1).id);
    expect(q.incoming).toContainEqual({
      value: 'B',
      moduleId: step(7).id,
      origin: 'previous-iteration',
    });
    const lastB = moduleDataFlow(loopGraph, step(7).id);
    expect(lastB.outgoing).toEqual([
      { value: 'B', moduleId: step(1).id, origin: 'next-iteration' },
    ]);
    expect(moduleDataFlow(loopGraph, step(8).id).outgoing).toEqual([
      { value: 'C_final', moduleId: null, origin: 'block-output' },
    ]);
  });

  it('uses connections outside a loop, and names the parent block of a loop step', () => {
    const graph = model([module('a'), module('b')], [['a', 'b', 'H']]);
    expect(moduleDataFlow(graph, 'b')).toEqual({
      kind: 'connections',
      incoming: [{ value: 'H', moduleId: 'a', origin: 'connection' }],
      outgoing: [],
    });
    expect(loopParentModule(topLevel, loopGraph)?.id).toBe('abcd');
    expect(loopParentModule(topLevel, graph)).toBeNull();
    const question = moduleExplanationQuestion(
      loopGraph,
      step(1),
      loopParentModule(topLevel, loopGraph),
    );
    expect(question).toContain('Do not propose or make any edit to the model.');
    expect(question).toContain('Source: q = q_proj(norm_b(B)) * exp(log_temp)');
    expect(question).toContain('- out: q to');
    expect(question).toContain('Block notes: 8 blocks share one structure');
    // A follow-up carries the same module context plus the last exchanges about it.
    const followUp = moduleFollowUpQuestion(
      loopGraph,
      step(1),
      loopParentModule(topLevel, loopGraph),
      [
        { role: 'assistant', body: 'q is the attention query.' },
        { role: 'user', body: 'and k?' },
        { role: 'assistant', body: `k is the key. ${'detail '.repeat(400)}` },
      ],
      '  log_temp는 왜 필요해?  ',
    );
    expect(followUp).toContain('Do not propose or make any edit to the model');
    expect(followUp).toContain('Source: q = q_proj(norm_b(B)) * exp(log_temp)');
    expect(followUp).toContain('Earlier question: and k?');
    expect(followUp).toContain('Earlier answer: q is the attention query.');
    expect(followUp).toContain('Question: log_temp는 왜 필요해?');
    // Long earlier answers are cut instead of filling the request.
    expect(followUp).toContain('…');
    expect(followUp.length).toBeLessThan(6000);
  });
});

describe('saved module discussions', () => {
  const answer = (body: string, minute: number) => ({
    role: 'assistant' as const,
    body,
    createdAt: new Date(Date.UTC(2026, 8, 19, 0, minute)).toISOString(),
  });

  it('keeps the module discussion in order, bounded, and keyed to what the module computes', () => {
    const target = step(1);
    let store = readModuleExplanations(null);
    store = withModuleExplanation(store, 'm', target, [answer('**q** is the attention query.', 0)]);
    expect(moduleExplanation(store, 'm', target)?.messages[0]?.body).toContain('attention query');
    // A follow-up appends the question and its answer to the same module.
    store = withModuleExplanation(store, 'm', target, [
      { role: 'user', body: 'log_temp는 왜 필요해?', createdAt: '2026-09-19T01:00:00Z' },
      answer('It is a learned temperature.', 60),
    ]);
    const thread = moduleExplanation(store, 'm', target)!;
    expect(thread.messages.map((message) => message.role)).toEqual([
      'assistant',
      'user',
      'assistant',
    ]);
    expect(thread.createdAt).toBe('2026-09-19T00:00:00.000Z');
    expect(thread.updatedAt).toBe('2026-09-19T01:00:00.000Z');
    // "Explain again" replaces the discussion instead of appending to it.
    const restarted = withModuleExplanation(
      store,
      'm',
      target,
      [answer('Fresh answer.', 120)],
      true,
    );
    expect(moduleExplanation(restarted, 'm', target)!.messages).toHaveLength(1);
    // A changed statement is a different module.
    expect(moduleExplanation(store, 'm', { ...target, transform: 'q = other(B)' })).toBeNull();
    expect(moduleExplanationKey(target)).toMatch(/^repeat-step:abcd:2#[0-9a-f]{8}$/u);
    const restored = readModuleExplanations(JSON.stringify(store));
    expect(moduleExplanation(restored, 'm', target)?.messages).toEqual(thread.messages);
    expect(readModuleExplanations('{broken')).toEqual({ schemaVersion: 1, models: {} });
    // A pre-conversation entry becomes the first answer of the discussion.
    const legacy = readModuleExplanations(
      JSON.stringify({
        schemaVersion: 1,
        models: {
          m: {
            [moduleExplanationKey(target)]: {
              body: 'Old answer.',
              createdAt: '2026-09-18T00:00:00Z',
            },
          },
        },
      }),
    );
    expect(moduleExplanation(legacy, 'm', target)?.messages).toEqual([
      { role: 'assistant', body: 'Old answer.', createdAt: '2026-09-18T00:00:00Z' },
    ]);
    // Only the last 20 messages of a module and the last 200 modules are kept.
    let long = readModuleExplanations(null);
    for (let index = 0; index < 25; index += 1)
      long = withModuleExplanation(long, 'm', target, [answer(`answer ${index}`, index)]);
    expect(moduleExplanation(long, 'm', target)!.messages).toHaveLength(20);
    for (let index = 0; index < 205; index += 1)
      store = withModuleExplanation(store, 'm', { ...target, transform: `q${index} = f(B)` }, [
        answer('x', index),
      ]);
    expect(Object.keys(store.models.m!)).toHaveLength(200);
  });
});

describe('module questions inside the Model Assistant conversation', () => {
  it('tags a question with its module and a line on what the module is', () => {
    const ref = moduleQuestionRef(step(1), 'question');
    expect(ref).toEqual({
      moduleId: 'repeat-step:abcd:2',
      key: moduleExplanationKey(step(1)),
      name: 'Compute q',
      location: 'FOR-LOOP · step 2',
      summary: 'Computes q: norm_b (normalization) → q_proj (linear projection) → exp.',
      kind: 'question',
    });
    // Later turns read the question with its module, whichever module is open by then.
    expect(
      moduleConversationBody({ role: 'user', body: 'log_temp는 왜 필요해?', moduleRef: ref }),
    ).toBe(
      '[Asked from the detail of module "Compute q" (id repeat-step:abcd:2, FOR-LOOP · step 2) — Computes q: norm_b (normalization) → q_proj (linear projection) → exp.]\nlog_temp는 왜 필요해?',
    );
    expect(moduleConversationBody({ role: 'assistant', body: 'Answer', moduleRef: ref })).toBe(
      'Answer',
    );
    expect(moduleConversationBody({ role: 'user', body: 'Plain question' })).toBe('Plain question');
    // Storage keeps a valid tag and drops a malformed one without losing the message.
    expect(readModuleQuestionRef(ref)).toEqual(ref);
    expect(readModuleQuestionRef({ ...ref, kind: 'other' })?.kind).toBe('question');
    expect(readModuleQuestionRef({ ...ref, moduleId: 7 })).toBeNull();
    expect(readModuleQuestionRef({ ...ref, summary: 'x'.repeat(401) })).toBeNull();
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const base = {
      modelId: 'm',
      modelVersion: '1',
      createdAt: '2026-09-21T00:00:00.000Z',
      role: 'user' as const,
    };
    saveModelLabChats(
      storage,
      {
        a: {
          draft: '',
          attachments: [],
          messages: [
            { ...base, id: 'tagged', body: 'log_temp?', moduleRef: ref },
            { ...base, id: 'broken', body: 'kept', moduleRef: { moduleId: 7 } as never },
          ],
        },
      },
      {},
    );
    const restored = loadModelLabChats(storage).a!.messages;
    expect(restored[0]!.moduleRef).toEqual(ref);
    expect(restored[1]!.body).toBe('kept');
    expect(restored[1]!.moduleRef).toBeUndefined();
  });

  it('reads the raw prompts saved by earlier versions as the question they carried', () => {
    const parent = topLevel.modules[0]!;
    const explain = moduleExplanationQuestion(loopGraph, step(1), parent);
    const followUp = moduleFollowUpQuestion(loopGraph, step(1), parent, [], 'A, B, C, D 가 뭔데?');
    expect(legacyModuleQuestion(explain)).toEqual({
      ref: {
        moduleId: 'repeat-step:abcd:2',
        key: 'repeat-step:abcd:2',
        name: 'Compute q',
        location: 'FOR-LOOP · step 2',
        summary: 'q = q_proj(norm_b(B)) * exp(log_temp)',
        kind: 'explain',
      },
      question: null,
    });
    expect(legacyModuleQuestion(followUp)?.question).toBe('A, B, C, D 가 뭔데?');
    expect(legacyModuleQuestion(followUp)?.ref.kind).toBe('question');
    expect(
      legacyModuleQuestion('Explain in detail what this one module does, generally'),
    ).toBeNull();
    expect(legacyModuleQuestion('What is q?')).toBeNull();
    // The Assistant panel shows the question and the tag instead of a 2,500-character prompt.
    expect(chatMessageDisplay({ role: 'user', body: followUp })).toMatchObject({
      body: 'A, B, C, D 가 뭔데?',
      moduleRef: { name: 'Compute q' },
    });
    expect(chatMessageDisplay({ role: 'user', body: explain }).body).toBe(
      'Explain this module in detail.',
    );
    expect(chatMessageDisplay({ role: 'assistant', body: explain }).moduleRef).toBeNull();
    expect(moduleConversationBody({ role: 'user', body: followUp })).toBe(
      '[Asked from the detail of module "Compute q" (id repeat-step:abcd:2, FOR-LOOP · step 2) — q = q_proj(norm_b(B)) * exp(log_temp)]\nA, B, C, D 가 뭔데?',
    );
  });

  it('finds a tagged module at the top level or inside a loop iteration, so the tag can open it', () => {
    expect(findGraphModule(topLevel, 'abcd', 'en')?.graphModel.id).toBe(topLevel.id);
    const inner = findGraphModule(topLevel, 'repeat-step:abcd:2', 'en');
    expect(inner?.module.name).toBe('Compute q');
    expect(inner?.graphModel.id).toBe(loopGraph.id);
    expect(findGraphModule(topLevel, 'removed-module', 'en')).toBeNull();
    const source = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(
      /findGraphModule\(graphComposition\.model, shown\.moduleRef\.moduleId\)/u,
    );
    expect(source).toContain('openModuleDetail(target.module, target.graphModel)');
  });
});

describe('module detail dialog', () => {
  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(ModuleDetailDialog, {
        model: loopGraph,
        module: step(3),
        probe: 'healthy',
        checkpointIndex: 0,
        onClose: () => undefined,
        ...props,
      }),
    );

  it('offers both arrows, the data flow with links, the parent block and the AI explanation', () => {
    const markup = render({
      onNavigate: () => undefined,
      parentBlock: topLevel.modules[0],
      aiExplanation: {
        conversation: [],
        entry: null,
        busy: false,
        error: null,
        onRequest: () => undefined,
        onAsk: async () => true,
      },
    });
    expect(markup).toContain('aria-label="Previous connected module: Compute k via k_proj"');
    expect(markup).toContain('aria-label="Next connected module: Residual update B"');
    expect(markup).toContain('Where its values come from and go');
    expect(markup).toContain('class="module-detail-flow__link"');
    expect(markup).toContain('block input or parameter');
    expect(markup).toContain('REPEATED BLOCK');
    expect(markup).toContain('8 blocks share one structure');
    expect(markup).toContain('Explain in detail with AI');
    // The question box is in the dialog itself, so asking never leaves the module.
    expect(markup).toContain('aria-label="Ask more about this module"');
    // The discussion is a panel beside the detail, not a section far below it.
    expect(markup).toContain('class="module-detail-dialog module-detail-dialog--copilot"');
    expect(markup).toContain('class="module-detail-dialog__columns"');
    expect(markup).toMatch(/<\/div><aside class="module-detail-copilot"/u);
    // The panel is the Model Assistant conversation itself: what was discussed in another module
    // is still here, each question saying which module it came from and what that module is.
    const turn = (
      id: string,
      role: 'user' | 'assistant',
      body: string,
      moduleRef?: ChatMessage['moduleRef'],
    ): ChatMessage => ({
      id,
      modelId: 'm',
      modelVersion: '1',
      createdAt: '2026-09-19T00:00:00Z',
      role,
      body,
      ...(moduleRef ? { moduleRef } : {}),
    });
    const conversation = [
      turn('u0', 'user', 'What does this model predict?'),
      turn('a0', 'assistant', 'A sparse coefficient vector.'),
      turn('u1', 'user', 'Explain this module in detail.', moduleQuestionRef(step(2), 'explain')),
      turn('a1', 'assistant', 'k is the key.', moduleQuestionRef(step(2), 'explain')),
      turn('u2', 'user', 'Explain this module in detail.', moduleQuestionRef(step(3), 'explain')),
      turn('a2', 'assistant', '**q** is the query.', moduleQuestionRef(step(3), 'explain')),
      turn('u3', 'user', 'log_temp는 왜 필요해?', moduleQuestionRef(step(3), 'question')),
      turn('a3', 'assistant', 'Learned temperature.', moduleQuestionRef(step(3), 'question')),
    ];
    const saved = render({
      onNavigate: () => undefined,
      aiExplanation: {
        conversation,
        entry: null,
        busy: false,
        error: 'Model Assistant is answering another question. Try again when it finishes.',
        onRequest: () => undefined,
        onAsk: async () => true,
      },
    });
    // The earlier general talk and the other module's explanation are part of the same thread…
    expect(saved).toContain('What does this model predict?');
    expect(saved).toContain('k is the key.');
    expect(saved.match(/data-module-question="other"/gu)).toHaveLength(2);
    expect(saved.match(/data-module-question="general"/gu)).toHaveLength(2);
    // …and the open module's own exchanges are marked, tagged and linked to nothing (it is open).
    expect(saved.match(/data-module-question="current"/gu)).toHaveLength(4);
    expect(saved).toContain('module-question-tag module-question-tag--current');
    expect(saved).toContain('Asked from module detail');
    expect(saved).toContain('Module explanation requested');
    // The other module's tag names it, says what it is, and opens it from here.
    expect(saved).toMatch(
      /<button type="button" class="module-question-tag__module" title="Open this module detail">.*?<strong>Compute k via k_proj<\/strong><small>FOR-LOOP · step 3<\/small>/u,
    );
    expect(saved).toContain(
      '<p>Computes k: norm_c (normalization) → k_proj (linear projection).</p>',
    );
    expect(saved).toContain('<strong>q</strong> is the query.');
    expect(saved).toContain('log_temp는 왜 필요해?');
    expect(saved).toContain('Learned temperature.');
    expect(saved).toContain('Explain again');
    expect(saved).toContain('role="alert"');
    // A failed question is reported beside the question box, under the discussion, where the
    // reader is looking. It used to sit above a long answer, out of view, and looked like no
    // reaction at all.
    const alertAt = saved.indexOf('role="alert"');
    expect(alertAt).toBeGreaterThan(saved.indexOf('Learned temperature.'));
    expect(alertAt).toBeGreaterThan(saved.indexOf('class="module-detail-copilot__footer"'));
    expect(alertAt).toBeLessThan(saved.indexOf('aria-label="Ask more about this module"'));
    // While Model Assistant answers, the box is locked instead of the dialog closing.
    // A discussion saved with the module is still offered when the conversation was cleared.
    const cleared = render({
      aiExplanation: {
        conversation: [turn('u0', 'user', 'Unrelated question')],
        entry: {
          messages: [
            { role: 'assistant', body: 'Stored answer.', createdAt: '2026-09-18T00:00:00Z' },
          ],
          createdAt: '2026-09-18T00:00:00Z',
          updatedAt: '2026-09-18T00:00:00Z',
        },
        busy: false,
        error: null,
        onRequest: () => undefined,
        onAsk: async () => true,
      },
    });
    // The saved explanation is in the explanation box itself, whatever the conversation holds
    // (2026-09-21: after 0.58.128 it was only a collapsed note in the Assistant panel).
    expect(cleared).toMatch(
      /<div class="module-detail-notes__ai" aria-labelledby="module-detail-notes-ai-title">[\s\S]*Model Assistant explanation[\s\S]*saved [^<]*2026[\s\S]*Stored answer\./u,
    );
    expect(cleared.indexOf('Stored answer.')).toBeLessThan(cleared.indexOf('At a glance'));
    expect(cleared).toContain('Explain again');
    expect(cleared).not.toContain('module-detail-copilot__saved');
    expect(saved).not.toContain('module-detail-copilot__saved');
    const busy = render({
      aiExplanation: {
        conversation: [],
        entry: null,
        busy: true,
        error: null,
        onRequest: () => undefined,
        onAsk: async () => true,
      },
    });
    expect(busy).toContain('Model Assistant is answering…');
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('class="module-detail-copilot__status" role="status"');
    // Without navigation the arrows are not shown, and without Assistant there is no side panel.
    expect(render({})).not.toContain('module-detail-nav');
    expect(render({})).not.toContain('module-detail-copilot');
    expect(render({})).toContain('class="module-detail-dialog"');
  });

  it('never stages an edit from an explanation request and keeps line breaks and keyboard arrows', () => {
    const source = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/!options\.explanationOnly &&\s+proposalIsFresh/u);
    // The follow-up runs through the same Model Assistant turn, without staging an edit.
    expect(source).toMatch(/onAsk: \(followUp\) =>\s+askAboutModule\(/u);
    expect(source).toMatch(/exchanges\.length > 0 \? exchanges : \(saved\?\.messages \?\? \[\]\)/u);
    // One conversation: the module turn is a tagged Model Assistant message whose visible body is
    // the question, the model receives the prompt with the module attached, and earlier module
    // questions stay attributed to their module in the history sent with every later turn.
    expect(source).toContain('question: options.prompt ?? submittedQuestion,');
    expect(source).toContain('body: moduleConversationBody(message),');
    expect(source).toMatch(
      /moduleRef: moduleQuestionRef\(target, followUp \? 'question' : 'explain'\)/u,
    );
    expect(source).toContain('conversation: messages,');
    expect(source).toMatch(/event\.key !== 'ArrowLeft' && event\.key !== 'ArrowRight'/u);
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(styles).toMatch(/\.module-detail-parent > p \{[^}]*white-space: pre-line;/u);
    // Two columns: the detail scrolls on the left, the discussion scrolls on the right with its
    // question box pinned under it.
    expect(styles).toMatch(
      /\.module-detail-dialog--copilot \.module-detail-dialog__columns \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(340px, 440px\);/u,
    );
    expect(styles).toMatch(/\.module-detail-copilot__thread \{[^}]*overflow: auto;/u);
    expect(styles).toMatch(/\.module-detail-copilot__footer \{[^}]*flex: 0 0 auto;/u);
    // A new answer is scrolled into view, and the box takes the cursor back when it finishes.
    expect(source).toMatch(/newest \? newest\.offsetTop - 8 : thread\.scrollHeight/u);
    expect(source).toMatch(/askedRef\.current = false;\s+askRef\.current\?\.focus\(\);/u);
  });

  it('marks graph cards whose module, or a step inside a collapsed loop, was explained', () => {
    const store = withModuleExplanation(readModuleExplanations(null), 'm', step(1), [
      { role: 'assistant', body: 'q is the query.', createdAt: '2026-09-19T00:00:00Z' },
    ]);
    const keys = new Set(Object.keys(store.models.m ?? {}));
    expect(keys.has(moduleExplanationKey(step(1)))).toBe(true);
    expect(keys.has(moduleExplanationKey(step(2)))).toBe(false);
    // The collapsed "ABCD block" card answers for the steps of its iteration.
    const block = composeRepeatedBlocks(topLevel, 'en').blocks[0]!;
    expect(
      block.detailModel.modules.some((candidate) => keys.has(moduleExplanationKey(candidate))),
    ).toBe(true);
    const graphSource = readFileSync(new URL('./model-graph.tsx', import.meta.url), 'utf8');
    const nodeSource = readFileSync(new URL('./module-node.tsx', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(graphSource).toMatch(
      /\(compositeBlock\?\.detailModel\.modules \?\? \[module\]\)\.some\(\(candidate\) =>\s+explainedKeys\.has\(moduleExplanationKey\(candidate\)\)/u,
    );
    // A new discussion re-renders the cards.
    expect(graphSource).toMatch(/changedStepIds,\s+explainedKeys,\s+graphModel,/u);
    expect(appSource).toContain('explainedKeys={explainedModuleKeys}');
    expect(nodeSource).toContain('className="module-node__ai-badge"');
    expect(nodeSource).toContain("uiText('AI explained')");
    // The mark must be found from across the canvas: a filled violet tag, and a ring around the
    // whole card (2026-09-21: the pale green pill looked like every other label).
    expect(nodeSource).toContain("${explained ? ' module-node--explained' : ''}");
    expect(styles).toMatch(/\.module-node__ai-badge \{[^}]*background: var\(--model-ai\)/u);
    expect(styles).toMatch(/\.module-node--explained \{[^}]*border-color: var\(--model-ai\)/u);
    expect(styles).toContain('.module-node--explained.module-node--selected {');
  });
});
