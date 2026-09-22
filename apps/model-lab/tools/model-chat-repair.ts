import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildModelChatEditPrompt,
  runCodexModelCopilot,
  MODEL_IR_OUTPUT_SCHEMA,
  prepareCopilotGraphEdit,
  MODEL_BUILDER_LARGE_SOURCE_TIMEOUT_MS,
} from '../model-copilot-server';
import { parseModelImportJson } from '../src/model-lab-import';
import { restoreModelPseudocodeWorkspace } from '../src/model-pseudocode';

// Explicit local diagnosis only. Never writes the source workspace or applies a revision.
const [workspacePath, modelId] = process.argv.slice(2);
if (!process.argv.includes('--live') || !workspacePath || !modelId)
  throw Error('usage: model-chat-repair <workspace.json> <model-id> --live');
const workspace = JSON.parse(await readFile(workspacePath, 'utf8')) as Record<string, string>;
const state = restoreModelPseudocodeWorkspace(
  workspace['gosu.model-lab.pseudocode-workspace.v1'] ?? null,
  [],
  { allowEmpty: true },
);
const base = state.histories[modelId]?.find(
  (r) => r.revision === state.selectedRevisions[modelId],
)?.model;
if (!base) throw Error('selected model not found');
const directory = await mkdtemp(join(tmpdir(), 'gosu-model-repair-'));
const instructions =
  'Repair this existing model graph, not just explain it. Preserve its stable model ID, module IDs and source equations. Recover full symbolic tensor axes from explicitly stored equations and invariants rather than preserving corrupted dimension metadata. Preserve intended repeated blocks and loop-carried state using the schema binding contract. Give every module an English name, a presentation selecting a canonical equation index, full-state versus slice dimension explanations, and uncertainty notes. Do not silently change ambiguous source transposes, Softmax axes or residual connections to make the audit pass. Represent genuinely unresolved internal operations explicitly while retaining known external tensor shapes. Return complete valid ModelIR. Do not claim observed runtime execution.';
await writeFile(join(directory, 'base.json'), JSON.stringify(base), { mode: 0o600 });
await writeFile(join(directory, 'request.txt'), instructions, { mode: 0o600 });
console.log(JSON.stringify({ directory, phase: 'started' }));
const start = Date.now();
const timer = setInterval(
  () =>
    console.log(
      JSON.stringify({ phase: 'generating', seconds: Math.round((Date.now() - start) / 1000) }),
    ),
  15000,
);
try {
  if (process.argv.includes('--repair')) {
    let attempt = 0;
    const result = await prepareCopilotGraphEdit(
      base,
      instructions,
      AbortSignal.timeout(2 * MODEL_BUILDER_LARGE_SOURCE_TIMEOUT_MS + 5000),
      { providerId: 'codex', model: 'gpt-6-astra', reasoning: 'medium', imagePaths: [] },
      async (...args) => {
        attempt++;
        const generated = await runCodexModelCopilot(...args);
        await writeFile(join(directory, `candidate-${attempt}.json`), generated.body, {
          mode: 0o600,
        });
        return generated;
      },
      (reason) => console.log(JSON.stringify({ phase: 'repairing', reason })),
    );
    if (result.ok)
      await writeFile(join(directory, 'validated.json'), JSON.stringify(result.model), {
        mode: 0o600,
      });
    console.log(
      JSON.stringify({
        directory,
        ok: result.ok,
        ...(!result.ok
          ? { code: result.code, reason: result.validationReason }
          : { modules: result.model.modules.length }),
        attempts: attempt,
      }),
    );
  } else {
    const result = await runCodexModelCopilot(
      buildModelChatEditPrompt(base, instructions),
      AbortSignal.timeout(MODEL_BUILDER_LARGE_SOURCE_TIMEOUT_MS + 5000),
      { providerId: 'codex', model: 'gpt-6-astra', reasoning: 'high', imagePaths: [] },
      { outputSchema: MODEL_IR_OUTPUT_SCHEMA },
    );
    await writeFile(join(directory, 'candidate.json'), result.body, { mode: 0o600 });
    const parsed = parseModelImportJson(result.body, {
      enforceSourceOutputContracts: true,
      enforceReadableNames: true,
    });
    console.log(
      JSON.stringify({
        directory,
        ok: parsed.ok,
        ...(!parsed.ok ? { reason: parsed.reason } : { modules: parsed.model.modules.length }),
      }),
    );
  }
} finally {
  clearInterval(timer);
}
