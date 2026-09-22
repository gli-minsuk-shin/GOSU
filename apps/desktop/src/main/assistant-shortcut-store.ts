import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AssistantShortcutSchema, DEFAULT_ASSISTANT_SHORTCUT } from '../shared/assistant-shortcut';
export class AssistantShortcutStore {
  private value = DEFAULT_ASSISTANT_SHORTCUT;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private path: string) {}
  get() {
    return this.value;
  }
  async load() {
    try {
      this.value = AssistantShortcutSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    return this.get();
  }
  set(raw: unknown) {
    const value = AssistantShortcutSchema.parse(raw);
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        await rename(temporary, this.path);
        this.value = value;
        return value;
      });
    this.queue = task;
    return task;
  }
}
