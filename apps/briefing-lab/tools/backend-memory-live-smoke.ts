// Opt-in native Keychain roundtrip; writes only a disposable public fixture, never private inbox data.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { BriefingMemoryStore } from '../briefing-memory-store';
import { systemBriefingKey } from '../briefing-system-key';
const temporary = await mkdtemp(join(tmpdir(), 'gosu-backend-memory-live-'));
const actualRuntime = join(homedir(), 'Library', 'Application Support', 'GOSU', 'briefing-lab');
try {
  const provider = () => systemBriefingKey(actualRuntime);
  const store = new BriefingMemoryStore(temporary, provider);
  const item = {
    id: 'public-memory-smoke',
    kind: 'papers' as const,
    title: 'Synthetic public optimization test',
    text: 'Public fixture evidence',
    source: 'fixture',
    readScope: 'abstract' as const,
    details: [],
  };
  const result = {
    overview: 'Test',
    items: [
      {
        id: item.id,
        summary: 'Synthetic summary remembered automatically',
        importance: 'medium' as const,
        importanceReason: 'Test',
        relevance: 'Optimization',
        action: '',
        evidenceQuote: 'Public fixture evidence',
        equationIds: [],
        figureIds: [],
        memorySuggestion: null,
      },
    ],
  };
  await store.record(
    'public-smoke',
    [item],
    result,
    { keywords: [], excluded: [] },
    new AbortController().signal,
  );
  const reopened = new BriefingMemoryStore(temporary, provider),
    memory = await reopened.related('public-smoke', 'optimization');
  if (!memory.some((e) => e.text.includes('remembered automatically')))
    throw new Error('memory_roundtrip_failed');
  const ciphertext = await readFile(join(temporary, 'memory.v2.enc.json'), 'utf8');
  if (ciphertext.includes('remembered automatically')) throw new Error('memory_plaintext');
  console.log(
    JSON.stringify({
      passed: true,
      keyProvider: 'macOS Keychain',
      restored: memory.length,
      plaintextOnDisk: false,
      privateMailRead: false,
    }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
