import { expect, it, vi } from 'vitest';
import {
  assistantWriteConsent,
  confirmingAssistantWrites,
  MODEL_LAB_ADD_CONSENT,
} from './briefing-project-bridge';

it('asks before adding a model only under the ask-every-time policy', async () => {
  const bridge = vi.fn(async () => ({ modelId: 'm' }));
  const consent = vi.fn(async () => undefined);
  const signal = new AbortController().signal;
  let ask = false;
  const wrapped = confirmingAssistantWrites(bridge, () => ask, consent);
  await wrapped('model-lab-add', 'p', '{}', signal);
  expect(consent).not.toHaveBeenCalled();
  ask = true;
  await wrapped('model-lab-add', 'p', '{}', signal);
  expect(consent).toHaveBeenCalledExactlyOnceWith(MODEL_LAB_ADD_CONSENT, signal);
  // Reads and the other writes keep their own handling.
  await wrapped('read', 'p', '', signal);
  await wrapped('notes', 'p', '{}', signal);
  await wrapped('experiments', 'p', '{}', signal);
  expect(consent).toHaveBeenCalledOnce();
  // A declined confirmation adds nothing.
  consent.mockRejectedValueOnce(new Error('native_consent_denied'));
  await expect(wrapped('model-lab-add', 'p', '{}', signal)).rejects.toThrow(
    'native_consent_denied',
  );
  expect(bridge).toHaveBeenCalledTimes(5);
});

it('asks before every research workspace write under the ask policy, naming what is added', async () => {
  const bridge = vi.fn(async () => ({ saved: true }));
  const consent = vi.fn(async (_message: string, _signal: AbortSignal) => undefined);
  const signal = new AbortController().signal;
  const wrapped = confirmingAssistantWrites(bridge, () => true, consent);
  await wrapped('note-save', 'p', JSON.stringify({ title: '실험 3 정리', content: 'x' }), signal);
  await wrapped(
    'literature-add',
    'p',
    JSON.stringify({ papers: [{ title: 'Attention Is All You Need' }, { title: 'LASSO' }] }),
    signal,
  );
  await wrapped('experiment-idea-add', 'p', JSON.stringify({ title: 'Axial B off' }), signal);
  await wrapped('experiment-metric-record', 'p', JSON.stringify({ value: 0.42 }), signal);
  const messages = consent.mock.calls.map(([message]) => message);
  expect(messages).toHaveLength(4);
  expect(messages[0]).toContain('새 노트를 만듭니다');
  expect(messages[0]).toContain('실험 3 정리');
  expect(messages[1]).toContain('논문 2편');
  expect(messages[1]).toContain('· Attention Is All You Need');
  expect(messages[2]).toContain('Axial B off');
  expect(messages[3]).toContain('0.42');
  // Malformed input still gets a generic confirmation; the desktop side rejects it.
  expect(assistantWriteConsent('note-save', '{')).toContain('새 노트를 만듭니다');
  expect(assistantWriteConsent('literature', '{}')).toBeNull();
});
