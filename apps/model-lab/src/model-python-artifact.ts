import type { ModelLabModelSelection } from './model-lab-runtime-adapter';
import type { ModelSpec } from './model-lab-schema';

export const MODEL_PYTHON_ARTIFACT_ENDPOINT = '/api/model-python-artifact';
export const MODEL_PYTHON_SOURCE_MAX_CHARACTERS = 200_000;

export type ModelPythonArtifactReceipt = Readonly<{
  schemaVersion: 1;
  modelId: string;
  revision: number;
  filename: 'model.py';
  entrypoint: string;
  framework: 'PyTorch';
  implementationStatus: 'executable' | 'scaffold';
  dependencies: readonly string[];
  generatedAt: string;
  sourceSha256: string;
  absolutePath: string;
  manifestPath: string;
  generator: string;
}>;

export type ModelPythonArtifact = Readonly<{
  receipt: ModelPythonArtifactReceipt;
  source: string;
  summary: string;
  trace: readonly string[];
}>;

export function modelPythonArtifactKey(modelId: string, revision: number) {
  return JSON.stringify([modelId, revision]);
}

export function isModelPythonArtifactReceipt(value: unknown): value is ModelPythonArtifactReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Partial<ModelPythonArtifactReceipt>;
  return (
    receipt.schemaVersion === 1 &&
    typeof receipt.modelId === 'string' &&
    Number.isInteger(receipt.revision) &&
    (receipt.revision ?? -1) >= 0 &&
    receipt.filename === 'model.py' &&
    typeof receipt.entrypoint === 'string' &&
    receipt.framework === 'PyTorch' &&
    (receipt.implementationStatus === 'executable' ||
      receipt.implementationStatus === 'scaffold') &&
    Array.isArray(receipt.dependencies) &&
    receipt.dependencies.every((dependency) => typeof dependency === 'string') &&
    typeof receipt.generatedAt === 'string' &&
    Number.isFinite(Date.parse(receipt.generatedAt)) &&
    typeof receipt.sourceSha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(receipt.sourceSha256) &&
    typeof receipt.absolutePath === 'string' &&
    typeof receipt.manifestPath === 'string' &&
    typeof receipt.generator === 'string'
  );
}

function parsedArtifact(value: unknown): ModelPythonArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('model_python_artifact_response_invalid');
  }
  const artifact = value as Partial<ModelPythonArtifact>;
  if (
    !isModelPythonArtifactReceipt(artifact.receipt) ||
    typeof artifact.source !== 'string' ||
    artifact.source.length === 0 ||
    artifact.source.length > MODEL_PYTHON_SOURCE_MAX_CHARACTERS ||
    typeof artifact.summary !== 'string' ||
    !Array.isArray(artifact.trace) ||
    !artifact.trace.every((entry) => typeof entry === 'string')
  ) {
    throw new Error('model_python_artifact_response_invalid');
  }
  return artifact as ModelPythonArtifact;
}

export function createModelPythonArtifactClient(fetchImpl: typeof fetch = fetch) {
  return {
    async generate(input: {
      model: ModelSpec;
      revision: number;
      selection: ModelLabModelSelection;
      signal?: AbortSignal;
    }) {
      const response = await fetchImpl(MODEL_PYTHON_ARTIFACT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          revision: input.revision,
          selection: input.selection,
        }),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const detail =
          payload && typeof payload === 'object' && 'detail' in payload
            ? String(payload.detail)
            : 'model_python_artifact_generation_failed';
        throw new Error(detail);
      }
      return parsedArtifact(payload);
    },

    async read(receipt: ModelPythonArtifactReceipt, signal?: AbortSignal) {
      const parameters = new URLSearchParams({
        modelId: receipt.modelId,
        revision: String(receipt.revision),
      });
      const response = await fetchImpl(`${MODEL_PYTHON_ARTIFACT_ENDPOINT}?${parameters}`, {
        headers: { Accept: 'application/json' },
        ...(signal ? { signal } : {}),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error('model_python_artifact_read_failed');
      return parsedArtifact(payload);
    },
  };
}

export const modelPythonArtifactClient = createModelPythonArtifactClient();
