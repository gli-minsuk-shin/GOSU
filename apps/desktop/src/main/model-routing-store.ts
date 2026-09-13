import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModelRoutingSchema, defaultModelRouting, type ModelRouting } from '@gosu/contracts';

/** Only model identifiers and usage choices; never credentials or conversation data. */
export class ModelRoutingStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private path: string) {}
  async get(): Promise<ModelRouting> {
    try {
      return ModelRoutingSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaultModelRouting();
      throw new Error('model_routing_unreadable', { cause: e });
    }
  }
  set(value: unknown): Promise<ModelRouting> {
    const policy = ModelRoutingSchema.parse(value);
    const operation = this.pending
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(policy), { mode: 0o600, flag: 'wx' });
          await rename(temporary, this.path);
        } finally {
          await rm(temporary, { force: true });
        }
        return policy;
      });
    this.pending = operation;
    return operation;
  }
}
