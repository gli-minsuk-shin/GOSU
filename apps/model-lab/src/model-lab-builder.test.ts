import { describe, expect, it, vi } from 'vitest';
import {
  createModelBuilder,
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
      { requestedModelId: 'claude-code:opus', reasoningOptionId: 'xhigh' },
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
        requestedModelId: 'claude-code:opus',
        reasoningOptionId: 'xhigh',
      },
    });
  });

  it('rejects unsupported executable checkpoint formats instead of pretending to import them', async () => {
    const file = new File(['weights'], 'model.pt', { type: 'application/octet-stream' });
    const prepared = await prepareModelBuildArtifact(file);
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.reason).toContain('ModelIR JSON, Python');
  });
});
