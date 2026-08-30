import { describe, expect, it, vi } from 'vitest';
import {
  createModelPythonArtifactClient,
  isModelPythonArtifactReceipt,
  MODEL_PYTHON_ARTIFACT_ENDPOINT,
  modelPythonArtifactKey,
} from './model-python-artifact';
import { residualClassifier } from './sample-models';

const receipt = {
  schemaVersion: 1 as const,
  modelId: residualClassifier.id,
  revision: 2,
  filename: 'model.py' as const,
  entrypoint: 'ResidualClassifier',
  framework: 'PyTorch' as const,
  implementationStatus: 'executable' as const,
  dependencies: ['torch'],
  generatedAt: '2026-08-30T00:00:00.000Z',
  sourceSha256: 'b'.repeat(64),
  absolutePath: '/tmp/gosu/residual/r2/model.py',
  manifestPath: '/tmp/gosu/residual/r2/manifest.json',
  generator: 'fixture',
};

const artifact = {
  receipt,
  source: 'import torch\nfrom torch import nn\nclass ResidualClassifier(nn.Module):\n    pass\n',
  summary: 'Executable residual classifier source.',
  trace: ['ModelIR → Python artifact'],
};

describe('Model Python artifact client', () => {
  it('generates and reads one revision-scoped Python artifact receipt', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(artifact), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(artifact), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const client = createModelPythonArtifactClient(fetchMock);
    await expect(
      client.generate({
        model: residualClassifier,
        revision: 2,
        selection: {
          providerId: 'codex',
          requestedModelId: 'gpt-5.6-sol',
          reasoningOptionId: 'high',
        },
      }),
    ).resolves.toEqual(artifact);
    await expect(client.read(receipt)).resolves.toEqual(artifact);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(MODEL_PYTHON_ARTIFACT_ENDPOINT);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: { id: residualClassifier.id },
      revision: 2,
      selection: { requestedModelId: 'gpt-5.6-sol' },
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `${MODEL_PYTHON_ARTIFACT_ENDPOINT}?modelId=`,
    );
  });

  it('validates immutable receipt identity and revision keys', () => {
    expect(isModelPythonArtifactReceipt(receipt)).toBe(true);
    expect(isModelPythonArtifactReceipt({ ...receipt, sourceSha256: 'not-a-hash' })).toBe(false);
    expect(modelPythonArtifactKey(residualClassifier.id, 2)).toBe(
      JSON.stringify([residualClassifier.id, 2]),
    );
  });
});
