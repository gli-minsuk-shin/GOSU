import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createModelBuilder,
  extractRtfText,
  modelBuildArtifactKind,
  prepareModelCopilotAttachment,
  prepareModelBuildArtifact,
} from './model-lab-builder';

const builtModel = {
  schemaVersion: 1,
  id: 'python-built-model',
  name: 'Python built model',
  version: 'source-reconstruction-v1',
  framework: 'PyTorch',
  sourceLabel: 'static reconstruction from network.py',
  sourceArtifacts: [{ path: 'network.py', verified: true }],
  summary: 'A two-layer network reconstructed from Python.',
  intent: {
    statement: 'Map input features to logits.',
    invariants: ['Output width is two.'],
    expectedInput: ['B', 4],
    expectedOutput: ['B', 2],
  },
  modules: [
    {
      id: 'input',
      name: 'Input',
      kind: 'input',
      group: 'Input',
      stage: 0,
      lane: 0,
      inputShape: ['B', 4],
      outputShape: ['B', 4],
      transform: 'identity',
      activation: null,
      formula: 'h_0=x',
      explanation: 'Feature input.',
      parameterCount: 0,
      codeReference: 'network.py:8',
    },
    {
      id: 'head',
      name: 'Classifier',
      kind: 'output',
      group: 'Output',
      stage: 1,
      lane: 0,
      inputShape: ['B', 4],
      outputShape: ['B', 2],
      transform: 'Linear(4, 2)',
      activation: null,
      formula: 'z=h_0W+b',
      explanation: 'Classifier projection.',
      parameterCount: 10,
      codeReference: 'network.py:5,9',
    },
  ],
  connections: [
    {
      id: 'input-to-head',
      source: 'input',
      target: 'head',
      tensorName: 'h_0',
      shape: ['B', 4],
      activationNorm: 0,
      expectedToCarryGradient: true,
    },
  ],
};

describe('Model Lab source builder client', () => {
  it('classifies and encodes Python as bounded static source evidence', async () => {
    const file = new File(
      ['import torch.nn as nn\nclass Net(nn.Module):\n    pass\n'],
      'network.py',
      { type: 'text/x-python' },
    );

    expect(modelBuildArtifactKind(file)).toBe('python');
    const prepared = await prepareModelBuildArtifact(file);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.artifact).toMatchObject({
      name: 'network.py',
      kind: 'python',
      encoding: 'utf8',
    });
    expect(prepared.artifact.content).toContain('class Net');
  });

  it('accepts ordinary text design files directly as UTF-8 evidence', async () => {
    const file = new File(
      ['Input [B, 16] -> Linear(16, 8) -> GELU -> Output [B, 8]'],
      'architecture.txt',
      { type: 'text/plain' },
    );
    const prepared = await prepareModelBuildArtifact(file);

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.artifact).toMatchObject({
      kind: 'text',
      encoding: 'utf8',
      content: expect.stringContaining('Linear(16, 8)'),
    });
  });

  it('extracts bounded visible model-design text from RTF without embedded destinations', async () => {
    const rtf = String.raw`{\rtf1\ansi\uc1{\fonttbl{\f0 Helvetica;}}\f0
Model \b architecture\b0\par
Input [B,16] \u8594? Linear(16,8)\par
Caf\'e9\tab Output [B,8]
{\*\comment hidden instruction}{\pict\pngblip 89504e47}}`;
    expect(extractRtfText(rtf)).toBe(
      ['Model architecture', 'Input [B,16] → Linear(16,8)', 'Café\tOutput [B,8]'].join('\n'),
    );

    const file = new File([rtf], 'architecture.rtf', { type: 'application/rtf' });
    expect(modelBuildArtifactKind(file)).toBe('text');
    const prepared = await prepareModelBuildArtifact(file);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.artifact).toMatchObject({
      name: 'architecture.rtf',
      kind: 'text',
      encoding: 'utf8',
      content: expect.stringContaining('Input [B,16] → Linear(16,8)'),
    });
    expect(prepared.artifact.content).not.toContain('fonttbl');
    expect(prepared.artifact.content).not.toContain('hidden instruction');
    expect(prepared.artifact.content).not.toContain('89504e47');

    const cocoaRtf = String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl\f0\fcharset0 Helvetica;\f1\fcharset129 AppleSDGothicNeo-Regular;}
\f0 Model \f1 \'b8\'f0\'b5\'a8\f0 \
Input [N,P] \
Output [N,1]}`;
    expect(extractRtfText(cocoaRtf)).toBe('Model 모델\nInput [N,P]\nOutput [N,1]');
  });

  it('treats JSON attached in Model Copilot as chat evidence rather than a ModelIR import', async () => {
    const file = new File(['{"question":"compare this config"}'], 'experiment.json', {
      type: 'application/json',
    });

    expect(modelBuildArtifactKind(file)).toBeNull();
    const prepared = await prepareModelCopilotAttachment(file);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.artifact).toEqual({
      name: 'experiment.json',
      mediaType: 'application/json',
      kind: 'text',
      encoding: 'utf8',
      content: '{"question":"compare this config"}',
    });
  });

  it('encodes a diagram image for the multimodal builder rather than staging it', async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'architecture.png', {
      type: 'image/png',
    });
    const prepared = await prepareModelBuildArtifact(file);

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.artifact.kind).toBe('image');
    expect(prepared.artifact.encoding).toBe('base64');
    expect(prepared.artifact.content).toBe('iVBORw==');
  });

  it('encodes a PDF so the server can extract its bounded architecture text', async () => {
    const file = new File(['%PDF-1.4\nmodel architecture'], 'paper.pdf', {
      type: 'application/pdf',
    });
    const prepared = await prepareModelBuildArtifact(file);

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.artifact).toMatchObject({
      name: 'paper.pdf',
      kind: 'pdf',
      encoding: 'base64',
    });
    expect(atob(prepared.artifact.content)).toContain('%PDF-1.4');
  });

  it('encodes DOCX as a bounded binary artifact for server-side paragraph extraction', async () => {
    const file = new File([new Uint8Array([80, 75, 3, 4])], 'architecture.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const prepared = await prepareModelBuildArtifact(file);

    expect(modelBuildArtifactKind(file)).toBe('docx');
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.artifact).toMatchObject({
      kind: 'docx',
      encoding: 'base64',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(prepared.artifact.content).toBe('UEsDBA==');
  });

  it('accepts a validated ModelIR response and creates a model with source provenance', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: builtModel,
            trace: ['Codex CLI · gpt-5.6-sol', 'Static reconstruction · python'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const builder = createModelBuilder(fetchImpl as typeof fetch);
    const result = await builder.build(
      [
        {
          name: 'network.py',
          mediaType: 'text/x-python',
          kind: 'python',
          encoding: 'utf8',
          content: 'class Net: pass',
        },
      ],
      {
        providerId: 'claude-code',
        requestedModelId: 'claude-code:opus',
        reasoningOptionId: 'xhigh',
      },
    );

    expect(result.model.id).toBe('python-built-model');
    expect(result.model.sourceArtifacts).toEqual([{ path: 'network.py', verified: true }]);
    expect(result.model.connections[0]?.gradient.states.healthy).toEqual(
      Array(5).fill('not-observed'),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/model-builder',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = (fetchImpl.mock.calls[0] as unknown as [unknown, RequestInit] | undefined)?.[1];
    expect(request).toBeDefined();
    expect(JSON.parse(String(request!.body))).toMatchObject({
      selection: {
        providerId: 'claude-code',
        requestedModelId: 'claude-code:opus',
        reasoningOptionId: 'xhigh',
      },
    });
  });

  it('streams truthful LLM import milestones before returning the validated model', async () => {
    const events = [
      {
        type: 'progress',
        progress: {
          phase: 'selection-resolved',
          message: 'GPT-5.6 Sol selected with high reasoning.',
          providerId: 'codex',
          modelId: 'gpt-5.6-sol',
          modelLabel: 'GPT-5.6 Sol',
          reasoning: 'high',
        },
      },
      {
        type: 'progress',
        progress: {
          phase: 'llm-running',
          message: 'LLM is reconstructing the architecture; internal reasoning is not streamed.',
        },
      },
      {
        type: 'progress',
        progress: {
          phase: 'model-ir-validating',
          message: 'Validating ModelIR and formula consistency.',
        },
      },
      { type: 'result', result: { model: builtModel, trace: ['Codex CLI · gpt-5.6-sol'] } },
    ].map((event) => `${JSON.stringify(event)}\n`);
    const encoded = new TextEncoder().encode(events.join(''));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 37));
        controller.enqueue(encoded.slice(37, 181));
        controller.enqueue(encoded.slice(181));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        }),
    );
    const progress: string[] = [];
    const result = await createModelBuilder(fetchImpl as typeof fetch).build(
      [
        {
          name: 'network.py',
          mediaType: 'text/x-python',
          kind: 'python',
          encoding: 'utf8',
          content: 'class Net: pass',
        },
      ],
      undefined,
      { onProgress: (event) => progress.push(event.phase) },
    );

    expect(progress).toEqual(['selection-resolved', 'llm-running', 'model-ir-validating']);
    expect(result.model.id).toBe('python-built-model');
    const request = (fetchImpl.mock.calls[0] as unknown as [unknown, RequestInit] | undefined)?.[1];
    expect(request?.headers).toMatchObject({
      Accept: 'application/x-ndjson, application/json',
    });
  });

  it('reports the exact streamed failure stage without emitting a false completion', async () => {
    const body = [
      JSON.stringify({
        type: 'progress',
        progress: { phase: 'llm-running', message: 'Waiting for ModelIR.' },
      }),
      JSON.stringify({
        type: 'error',
        stage: 'llm-running',
        detail: 'The selected LLM exited before returning ModelIR.',
      }),
      '',
    ].join('\n');
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        }),
    );
    const progress: Array<{ phase: string; message: string }> = [];

    await expect(
      createModelBuilder(fetchImpl as typeof fetch).build([], undefined, {
        onProgress: (event) => progress.push(event),
      }),
    ).rejects.toThrow('The selected LLM exited before returning ModelIR.');
    expect(progress.map((event) => event.phase)).toEqual(['llm-running', 'failed']);
    expect(progress.at(-1)?.message).toContain('Failed during llm-running');
    expect(progress.some((event) => event.phase === 'model-ir-validated')).toBe(false);
  });

  it('rejects unsupported executable checkpoint formats instead of pretending to import them', async () => {
    const file = new File(['weights'], 'model.pt', { type: 'application/octet-stream' });
    const prepared = await prepareModelBuildArtifact(file);
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.reason).toContain('ModelIR JSON, Python');
  });

  it('exposes a separate GOSU model and reasoning picker for source reconstruction', () => {
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(appSource).toContain('aria-label="Model Builder LLM selection"');
    expect(appSource).toContain('aria-label="Model Builder model"');
    expect(appSource).toContain('aria-label="Model Builder reasoning"');
    expect(appSource).toContain('.docx,.rtf,.py');
    expect(appSource).toContain('PDF · DOCX · RTF · text');
    expect(appSource).toContain('codexModelBuilder.build(sourceArtifacts, builderSelection, {');
    expect(appSource).toContain('onProgress: (progress)');
    expect(appSource).not.toContain('codexModelBuilder.build(sourceArtifacts, copilotSelection)');
    expect(appSource).toContain('ModelIR JSON imports directly without an LLM');
    expect(styles).toMatch(
      /\.model-builder-selection \{[\s\S]*?grid-template-columns: minmax\(0, 1\.25fr\) minmax\(0, 0\.85fr\);/u,
    );
    expect(styles).toContain('.model-builder-selection select {');
  });
});
