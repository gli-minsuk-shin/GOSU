export type ModelLabHostConfiguration = Readonly<{
  projectId: string;
  projectName: string;
  basePath: string;
  storage: Record<string, string>;
}>;
export type ModelLabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  retry?: () => void;
  flush?: () => Promise<void>;
};

export function parseModelLabHostConfiguration(
  text: string | null,
): ModelLabHostConfiguration | null {
  if (!text) return null;
  const value = JSON.parse(text) as ModelLabHostConfiguration;
  if (
    !value ||
    typeof value.projectId !== 'string' ||
    typeof value.projectName !== 'string' ||
    !/^\/s\/[a-f0-9]{64}\/[a-f0-9-]{36}\/$/.test(value.basePath) ||
    value.basePath.split('/')[3] !== value.projectId ||
    !value.storage ||
    typeof value.storage !== 'object' ||
    Array.isArray(value.storage) ||
    Object.entries(value.storage).some(
      ([key, item]) => !key.startsWith('gosu.model-lab.') || typeof item !== 'string',
    )
  ) {
    throw new Error('Invalid embedded Model Lab configuration');
  }
  return value;
}

let configuration: ModelLabHostConfiguration | null | undefined;
export function modelLabHostConfiguration() {
  if (typeof document === 'undefined') return null;
  configuration ??= parseModelLabHostConfiguration(
    document.getElementById('gosu-model-lab-host')?.textContent ?? null,
  );
  return configuration;
}

export function scopedModelLabUrl(url: string, host: ModelLabHostConfiguration | null) {
  if (!host) return url;
  if (!url.startsWith('/api/') || url.includes('..') || url.includes('\\'))
    throw new Error('Invalid Model Lab API route');
  return `${host.basePath}${url.slice(1)}`;
}

export const modelLabFetch: typeof fetch = (input, options) => {
  if (typeof input !== 'string') throw new Error('Model Lab expects a bounded API path');
  return fetch(scopedModelLabUrl(input, modelLabHostConfiguration()), options);
};

export function createHostedModelLabStorage(
  host: ModelLabHostConfiguration,
  write: (key: string, value: string | null) => Promise<void>,
  onStatus: (status: 'saving' | 'saved' | 'failed') => void,
) {
  const values = new Map(Object.entries(host.storage));
  let pending = Promise.resolve();
  let pendingCount = 0;
  const failed = new Set<string>();
  const persist = (key: string, value: string | null) => {
    pendingCount++;
    onStatus('saving');
    pending = pending
      .catch(() => undefined)
      .then(() => write(key, value))
      .then(
        () => {
          failed.delete(key);
          pendingCount--;
          onStatus(failed.size ? 'failed' : pendingCount ? 'saving' : 'saved');
        },
        (error: unknown) => {
          failed.add(key);
          pendingCount--;
          onStatus('failed');
          throw error;
        },
      );
    void pending.catch(() => undefined);
  };
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      if (values.get(key) === value && !failed.has(key)) return;
      values.set(key, value);
      persist(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
      persist(key, null);
    },
    retry: () => {
      for (const key of [...failed]) persist(key, values.get(key) ?? null);
    },
    flush: async () => {
      await pending;
      if (failed.size) throw new Error('Project Model Lab save failed');
    },
  };
}

let hostedStorage: ReturnType<typeof createHostedModelLabStorage> | undefined;
export function modelLabStorage(): ModelLabStorage | null {
  if (typeof window === 'undefined') return null;
  const host = modelLabHostConfiguration();
  if (!host) {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
  hostedStorage ??= createHostedModelLabStorage(
    host,
    async (key, value) => {
      const response = await modelLabFetch('/api/model-lab-storage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (!response.ok) throw new Error('Project Model Lab save failed');
    },
    (status) => window.dispatchEvent(new CustomEvent('gosu-model-lab-save', { detail: status })),
  );
  return hostedStorage;
}
