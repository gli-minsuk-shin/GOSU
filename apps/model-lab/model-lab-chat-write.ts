import { createHash } from 'node:crypto';
import {
  MODEL_PSEUDOCODE_LLM_GUIDE,
  MODEL_PSEUDOCODE_MAX_CHARACTERS,
} from './src/model-pseudocode';

/** What a chat receives after asking to add a model to a project's Model Lab. */
export type ModelLabWriteReceipt = Readonly<{
  requestId: string;
  modelId: string;
  modelName: string;
  /** added: an open Model Lab adopted it; queued: it is adopted when the project's Model Lab opens. */
  status: 'added' | 'queued';
}>;
export type ModelLabWriter = (
  projectId: string,
  input: { requestId: string; pseudocode: string },
) => Promise<ModelLabWriteReceipt>;

const SUBJECT = /(?:model\s*lab|모델\s*랩)/iu;
const ACTION =
  /(?:추가|넣어|넣어줘|넣자|넣을|등록|올려|만들어|생성|저장|\badd\b|\bimport\b|\bcreate\b|\bput\b|\bsave\b|\bregister\b)/iu;
const DENIAL =
  /(?:\b(?:do\s+not|don't|never)\b.{0,60}\b(?:add|import|create|put|save|register)\b|(?:추가|넣|등록|저장|만들|생성)(?:하|해)?지\s*(?:마|말))/iu;
const EXPLANATION = /(?:\bhow\s+(?:do|can|should|to)\b|어떻게|방법|사용법)/iu;

/**
 * A chat may add a model only when the user's own message asks for it: naming Model Lab and an
 * add/import verb, without a denial or a how-to question. The chat cannot grant itself this.
 */
export function explicitlyAuthorizesModelLabWrite(message: string) {
  const text = message.normalize('NFKC').trim();
  return (
    text.length > 0 &&
    SUBJECT.test(text) &&
    ACTION.test(text) &&
    !DENIAL.test(text) &&
    !EXPLANATION.test(text)
  );
}

/** A request id that is the same for the same model in the same turn, so a retry adds it once. */
export function chatModelRequestId(scope: string, pseudocode: string) {
  const hex = createHash('sha256').update(`${scope}\n${pseudocode}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const MODEL_LAB_MAX_ADDS_PER_TURN = 4;

export const MODEL_LAB_ADD_TOOL_DESCRIPTION = `Add ONE new model to this project's Model Lab. Only offered because the user explicitly asked to put a model into Model Lab in this message. Write the whole architecture as GOSU Model Pseudocode v2 (at most ${MODEL_PSEUDOCODE_MAX_CHARACTERS.toLocaleString('en-US')} characters) from evidence you actually read (files, run contracts, code); describe unknown details as unknown instead of inventing them. GOSU validates it with Model Lab's own parser: on model_lab_pseudocode_invalid, fix the reported problem and call again. Success returns a receipt {modelId, modelName, status}: added means the open Model Lab now shows it; queued means it appears the next time this project's Model Lab opens. Never claim a model was added without that receipt. It never edits, replaces or deletes existing models, and never trains or runs code. Nested model references (subgraph) are not supported here.

${MODEL_PSEUDOCODE_LLM_GUIDE}`;

/** Stable codes (and a parser reason) for a failed add, never raw paths or stack text. */
export function modelLabWriteFailure(error: unknown): { error: string; reason?: string } {
  const message = error instanceof Error ? error.message : '';
  const invalid = /^model_lab_pseudocode_invalid: ([\s\S]*)$/.exec(message);
  if (invalid) return { error: 'model_lab_pseudocode_invalid', reason: invalid[1]!.slice(0, 600) };
  if (message === 'Model copy inbox is full') return { error: 'model_lab_inbox_full' };
  if (message.includes('64-model workspace limit')) return { error: 'model_lab_model_limit' };
  if (
    [
      'model_lab_project_unavailable',
      'model_lab_request_conflict',
      'model_lab_request_invalid',
      'model_lab_host_unavailable',
    ].includes(message)
  )
    return { error: message };
  return { error: 'model_lab_write_unavailable' };
}
