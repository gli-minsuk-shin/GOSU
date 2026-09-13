import { z } from 'zod';
import { BriefingMemorySchema, type BriefingMemory } from './briefing-intelligence';
export const BRIEFING_MEMORY_KEY = 'gosu.briefing.encrypted-memory.v1';
const Envelope = z
  .object({
    version: z.literal(1),
    salt: z.string().max(64),
    iv: z.string().max(64),
    ciphertext: z.string().max(3_000_000),
  })
  .strict();
const bytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const base64 = (value: Uint8Array) => {
  let result = '';
  for (let i = 0; i < value.length; i += 8192)
    result += String.fromCharCode(...value.subarray(i, i + 8192));
  return btoa(result);
};
async function derive(password: string, salt: Uint8Array) {
  if (password.length < 12) throw new Error('Memory 암호는 12자 이상이어야 합니다.');
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 250000, salt: salt as BufferSource },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function openBriefingVault(storage: Pick<Storage, 'getItem'>, password: string) {
  const raw = storage.getItem(BRIEFING_MEMORY_KEY);
  let memory: BriefingMemory = { version: 1, entries: [] };
  if (raw && raw.length > 3_100_000) throw new Error('Memory 저장소가 너무 큽니다.');
  const envelope = raw ? Envelope.parse(JSON.parse(raw)) : null;
  const salt = envelope ? bytes(envelope.salt) : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error('Memory salt가 유효하지 않습니다.');
  const key = await derive(password, salt);
  if (envelope) {
    try {
      const iv = bytes(envelope.iv);
      if (iv.length !== 12) throw Error();
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        bytes(envelope.ciphertext),
      );
      memory = BriefingMemorySchema.parse(JSON.parse(new TextDecoder().decode(plain)));
    } catch {
      throw new Error('Memory 암호가 틀렸거나 저장소가 손상됐습니다. 기존 데이터는 보존했습니다.');
    }
  }
  return { memory, key, salt, encoded: raw };
}
export async function saveBriefingVault(
  storage: Pick<Storage, 'setItem' | 'getItem'>,
  vault: { key: CryptoKey; salt: Uint8Array; encoded: string | null },
  memory: BriefingMemory,
) {
  const data = new TextEncoder().encode(JSON.stringify(BriefingMemorySchema.parse(memory)));
  if (data.length > 2_000_000) throw new Error('Memory 용량 제한입니다. 오래된 항목을 지워주세요.');
  const write = async () => {
    if (storage.getItem(BRIEFING_MEMORY_KEY) !== vault.encoded)
      throw new Error('다른 창에서 Memory가 변경됐습니다. 다시 잠금 해제한 뒤 저장해주세요.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vault.key, data);
    const encoded = JSON.stringify({
      version: 1,
      salt: base64(vault.salt),
      iv: base64(iv),
      ciphertext: base64(new Uint8Array(encrypted)),
    });
    storage.setItem(BRIEFING_MEMORY_KEY, encoded);
    vault.encoded = encoded;
  };
  if (typeof navigator !== 'undefined' && navigator.locks)
    await navigator.locks.request(BRIEFING_MEMORY_KEY, write);
  else await write();
}
