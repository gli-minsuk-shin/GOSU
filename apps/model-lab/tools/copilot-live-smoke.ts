import { runNativeModelLabAgent } from '../model-lab-native-agent';
import { bottleneckAutoencoder } from '../src/sample-models';
import { parseModelImportJson } from '../src/model-lab-import';
import {
  buildModelCopilotInstructions,
  buildModelCopilotPrompt,
  prepareCopilotGraphEdit,
  runCodexModelCopilot,
} from '../model-copilot-server';
if (!process.argv.includes('--live'))
  throw Error('Explicit --live required; synthetic model only.');
const request = {
  projectModels: [bottleneckAutoencoder],
  activeModelId: bottleneckAutoencoder.id,
  selectedModuleId: bottleneckAutoencoder.modules[0]!.id,
  probe: 'healthy' as const,
  checkpointIndex: 0,
  question: 'Explain this model input and output in one sentence. Do not change the model.',
};
const start = Date.now();
try {
  const result = await runNativeModelLabAgent({
    request,
    seedPrompt: buildModelCopilotPrompt(request),
    developerInstructions: buildModelCopilotInstructions(request),
    signal: AbortSignal.timeout(90000),
    invocation: { providerId: 'codex', model: 'gpt-6-astra', reasoning: 'high', imagePaths: [] },
    onProgress: (p) => console.log(JSON.stringify({ phase: p.phase, elapsed: Date.now() - start })),
  });
  if (!result.body.trim()) throw Error('empty_answer');
  if (process.argv.includes('--edit')) {
    const edit = await prepareCopilotGraphEdit(
      bottleneckAutoencoder,
      'Keep all topology, dimensions, IDs and equations unchanged. Make the summary one clear sentence explaining the 128 to 24 to 128 bottleneck.',
      AbortSignal.timeout(90000),
      { providerId: 'codex', model: 'gpt-6-astra', reasoning: 'high', imagePaths: [] },
      async (...args) => {
        const result = await runCodexModelCopilot(...args);
        const parsed = parseModelImportJson(result.body, { enforceSourceOutputContracts: true });
        if (!parsed.ok) console.log(JSON.stringify({ validation: parsed.reason }));
        return result;
      },
    );
    console.log(
      JSON.stringify({
        editOk: edit.ok,
        ...(!edit.ok ? { code: edit.code } : { modules: edit.model.modules.length }),
      }),
    );
    if (!edit.ok) throw Error(edit.code);
    if (edit.model.modules.some((m) => !m.presentation)) throw Error('graph_presentation_missing');
  }
  console.log(
    JSON.stringify({
      ok: true,
      elapsed: Date.now() - start,
      model: result.model,
      answer: result.body,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      elapsed: Date.now() - start,
      code: error instanceof Error ? error.message : 'unknown',
    }),
  );
  process.exitCode = 1;
}
