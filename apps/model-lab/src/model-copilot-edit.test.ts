import { expect, it, vi } from 'vitest';
import {
  collectChild,
  modelCopilotExecutionLimits,
  MODEL_IR_OUTPUT_SCHEMA,
  prepareCopilotGraphEdit,
  preserveCopilotAnalysisAfterEditFailure,
} from '../model-copilot-server';
import { bottleneckAutoencoder } from './sample-models';
import { modelLabRuntimeErrorCode, modelLabRuntimeErrorMessage } from './model-lab-runtime-adapter';
const invocation = { providerId: 'codex', model: 'fixture', reasoning: 'high', imagePaths: [] };
const signal = () => new AbortController().signal;
function validProposal() {
  return {
    ...structuredClone(bottleneckAutoencoder),
    modules: bottleneckAutoencoder.modules.map((m) => ({
      ...m,
      inputPorts: bottleneckAutoencoder.connections.some((c) => c.target === m.id)
        ? bottleneckAutoencoder.connections
            .filter((c) => c.target === m.id)
            .map((c) => ({ name: `in-${c.id}`, shape: c.shape, binding: 'internal' }))
        : [{ name: 'input', shape: m.inputShape, binding: 'external' }],
      outputPorts: bottleneckAutoencoder.connections.some((c) => c.source === m.id)
        ? bottleneckAutoencoder.connections
            .filter((c) => c.source === m.id)
            .map((c) => ({ name: `out-${c.id}`, shape: c.shape, binding: 'internal' }))
        : [{ name: 'output', shape: m.outputShape, binding: 'external' }],
    })),
    connections: bottleneckAutoencoder.connections.map((c) => ({
      ...c,
      sourcePort: `out-${c.id}`,
      targetPort: `in-${c.id}`,
    })),
  };
}
it('feeds the actual validator failure back once, validates the repair and counts both calls', async () => {
  const usage = {
    inputTokens: 10,
    outputTokens: 5,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    totalTokens: 15,
  };
  const runner = vi
    .fn()
    .mockResolvedValueOnce({ body: '{}', usage })
    .mockResolvedValueOnce({ body: JSON.stringify(validProposal()), usage });
  const repair = vi.fn();
  const base = structuredClone(bottleneckAutoencoder);
  const result = await prepareCopilotGraphEdit(
    base,
    'Repair source contracts',
    signal(),
    invocation,
    runner,
    repair,
  );
  expect(result.ok).toBe(true);
  expect(result.usage?.totalTokens).toBe(30);
  expect(runner).toHaveBeenCalledTimes(2);
  expect(repair).toHaveBeenCalledOnce();
  expect(runner.mock.calls[1]![0]).toContain(repair.mock.calls[0]![0]);
  expect(runner.mock.calls[1]![0]).toContain('FULL INVALID CANDIDATE\n{}');
  expect(base).toEqual(bottleneckAutoencoder);
});
it('stops before the repair call when cancelled after validation', async () => {
  const c = new AbortController();
  const runner = vi.fn(async () => ({
    body: '{}',
    provider: 'fixture',
    model: 'fixture',
    reasoning: 'high',
  }));
  await expect(
    prepareCopilotGraphEdit(bottleneckAutoencoder, 'Fix', c.signal, invocation, runner, () =>
      c.abort(),
    ),
  ).rejects.toThrow('aborted');
  expect(runner).toHaveBeenCalledOnce();
});
it('shows bounded validation details instead of only an opaque failure', () => {
  const result = preserveCopilotAnalysisAfterEditFailure(
    { body: 'Analysis', trace: [] },
    'model_copilot_edit_invalid',
    true,
    'Named input port does not match',
  );
  expect(result.body).toContain('검증 상세: Named input port does not match');
});
it.each([true, false])('preserves the actual analysis and reports edit-only failure (%s)', (ko) => {
  const answer = {
    body: 'Actual analysis',
    trace: ['native answer'],
    contextUsage: { inputTokens: 5 },
  };
  const result = preserveCopilotAnalysisAfterEditFailure(answer, 'model_copilot_edit_invalid', ko);
  expect(result.body).toContain(answer.body);
  expect(result.body).toContain(
    ko ? '기존 모델은 변경하지 않았습니다' : 'existing model is unchanged',
  );
  expect(result.contextUsage).toEqual(answer.contextUsage);
  expect(result).not.toHaveProperty('editProposal');
  expect(answer.body).toBe('Actual analysis');
});
it.each([false, true])(
  'accepts validated proposals but rejects changing the stable model identity (%s)',
  async (changeId) => {
    const model = {
      ...structuredClone(bottleneckAutoencoder),
      id: changeId ? 'different' : bottleneckAutoencoder.id,
      modules: bottleneckAutoencoder.modules.map((m) => ({
        ...m,
        inputPorts: bottleneckAutoencoder.connections.some((c) => c.target === m.id)
          ? bottleneckAutoencoder.connections
              .filter((c) => c.target === m.id)
              .map((c) => ({ name: `in-${c.id}`, shape: c.shape, binding: 'internal' }))
          : [{ name: 'input', shape: m.inputShape, binding: 'external' }],
        outputPorts: bottleneckAutoencoder.connections.some((c) => c.source === m.id)
          ? bottleneckAutoencoder.connections
              .filter((c) => c.source === m.id)
              .map((c) => ({ name: `out-${c.id}`, shape: c.shape, binding: 'internal' }))
          : [{ name: 'output', shape: m.outputShape, binding: 'external' }],
      })),
      connections: bottleneckAutoencoder.connections.map((c) => ({
        ...c,
        sourcePort: `out-${c.id}`,
        targetPort: `in-${c.id}`,
      })),
    };
    const result = await prepareCopilotGraphEdit(
      bottleneckAutoencoder,
      'Fix',
      signal(),
      invocation,
      async () => ({
        body: JSON.stringify(model),
        provider: 'fixture',
        model: 'fixture',
        reasoning: 'high',
      }),
    );
    expect(result.ok).toBe(!changeId);
    if (!result.ok) expect(result.code).toBe('model_copilot_edit_stable_id_changed');
  },
);
it('gives full graph generation its own bounded output and time budget', async () => {
  const limit = modelCopilotExecutionLimits(MODEL_IR_OUTPUT_SCHEMA);
  expect(limit).toEqual({ timeoutMs: 900000, maxOutputBytes: 2 * 1024 * 1024 });
  expect(modelCopilotExecutionLimits()).toEqual({ timeoutMs: 120000, maxOutputBytes: 96 * 1024 });
  const output = await collectChild(
    process.execPath,
    ['-e', 'process.stdout.write("x".repeat(150000))'],
    null,
    signal(),
    5000,
    process.cwd(),
    limit.maxOutputBytes,
  );
  expect(output.stdout).toHaveLength(150000);
});
it.each(['model_copilot_timeout', 'model_copilot_output_too_large', 'private raw failure'])(
  'returns a safe edit-only failure without mutating the model: %s',
  async (code) => {
    const original = structuredClone(bottleneckAutoencoder);
    const runner = vi.fn(async () => {
      throw Error(code);
    });
    const result = await prepareCopilotGraphEdit(
      original,
      'Fix graph',
      signal(),
      invocation,
      runner,
    );
    expect(result).toEqual({
      ok: false,
      code: code.startsWith('model_copilot_') ? code : 'model_copilot_edit_failed',
    });
    expect(original).toEqual(bottleneckAutoencoder);
    expect(runner).toHaveBeenCalledOnce();
  },
);
it('does not turn cancellation into a saved edit failure or launch a cancelled request', async () => {
  const c = new AbortController();
  c.abort();
  const runner = vi.fn();
  await expect(
    prepareCopilotGraphEdit(bottleneckAutoencoder, 'Fix', c.signal, invocation, runner),
  ).rejects.toThrow('aborted');
  expect(runner).not.toHaveBeenCalled();
  await expect(collectChild('/nonexistent', [], null, c.signal, 100)).rejects.toThrow('aborted');
});
it('rejects malformed graph output', async () => {
  const runner = vi.fn(async () => ({
    body: '{}',
    provider: 'fixture',
    model: 'fixture',
    reasoning: 'high',
  }));
  expect(
    await prepareCopilotGraphEdit(bottleneckAutoencoder, 'Fix', signal(), invocation, runner),
  ).toMatchObject({
    ok: false,
    code: 'model_copilot_edit_invalid',
    validationReason: expect.any(String),
  });
  expect(runner).toHaveBeenCalledTimes(2);
});
it('distinguishes timeout, output size and process errors without exposing arbitrary text', () => {
  expect(modelLabRuntimeErrorMessage('model_copilot_timeout')).toContain('time limit');
  expect(modelLabRuntimeErrorMessage('model_copilot_output_too_large')).toContain('size limit');
  expect(modelLabRuntimeErrorCode('model_copilot_codex_exit_1')).toBe(
    'model_copilot_process_failed',
  );
  expect(modelLabRuntimeErrorCode('model_copilot_codex_exit_1 secret')).toBe(
    'model_copilot_llm_unavailable',
  );
});
