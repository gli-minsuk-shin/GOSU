import { describe, expect, it } from 'vitest';
import {
  chatModelRequestId,
  explicitlyAuthorizesModelLabWrite,
  modelLabWriteFailure,
  MODEL_LAB_ADD_TOOL_DESCRIPTION,
} from './model-lab-chat-write';

describe('Model Lab writes from chat', () => {
  it('opens only when the user explicitly asks to put a model into Model Lab', () => {
    for (const message of [
      '이 모델 아키텍처 보고 Model Lab에 추가해줘',
      '모델랩에 이 모델 넣어줘',
      'GCSA 모델을 모델 랩에 등록해 줘',
      'Please add this architecture to Model Lab',
      'import the model into model lab',
    ])
      expect(explicitlyAuthorizesModelLabWrite(message), message).toBe(true);
    for (const message of [
      'Model Lab에 있는 모델 보여줘',
      'Model Lab에 어떻게 추가해?',
      'Model Lab에는 추가하지 마',
      "don't add it to Model Lab",
      '이 모델 구조 설명해줘',
      'add a baseline experiment',
    ])
      expect(explicitlyAuthorizesModelLabWrite(message), message).toBe(false);
  });

  it('gives the same request id for the same model in the same turn and a new one elsewhere', () => {
    const id = chatModelRequestId('turn-1', 'MODEL x');
    expect(id).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    expect(chatModelRequestId('turn-1', 'MODEL x')).toBe(id);
    expect(chatModelRequestId('turn-2', 'MODEL x')).not.toBe(id);
    expect(chatModelRequestId('turn-1', 'MODEL y')).not.toBe(id);
  });

  it('tells the model how to write pseudocode and turns failures into codes it can act on', () => {
    expect(MODEL_LAB_ADD_TOOL_DESCRIPTION).toContain('GOSU Model Pseudocode v2');
    expect(MODEL_LAB_ADD_TOOL_DESCRIPTION).toMatch(/receipt/i);
    expect(
      modelLabWriteFailure(new Error('model_lab_pseudocode_invalid: Unknown BLOCK b2')),
    ).toEqual({ error: 'model_lab_pseudocode_invalid', reason: 'Unknown BLOCK b2' });
    expect(modelLabWriteFailure(new Error('Model copy inbox is full'))).toEqual({
      error: 'model_lab_inbox_full',
    });
    expect(
      modelLabWriteFailure(new Error('Destination has reached the 64-model workspace limit')),
    ).toEqual({ error: 'model_lab_model_limit' });
    expect(modelLabWriteFailure(new Error('model_lab_project_unavailable'))).toEqual({
      error: 'model_lab_project_unavailable',
    });
    expect(modelLabWriteFailure(new Error('EACCES'))).toEqual({
      error: 'model_lab_write_unavailable',
    });
  });
});
