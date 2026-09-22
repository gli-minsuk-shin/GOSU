import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AppShortcutsSchema,
  DEFAULT_APP_SHORTCUTS,
  type AppShortcuts,
} from '../shared/app-shortcuts';

/** Key chords only. A missing file means the defaults; an unreadable one is reported, not reset. */
export class AppShortcutStore {
  private value: AppShortcuts = DEFAULT_APP_SHORTCUTS;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  get() {
    return this.value;
  }
  async load() {
    try {
      this.value = AppShortcutsSchema.parse(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return this.get();
  }
  async set(raw: unknown): Promise<AppShortcuts> {
    const value = AppShortcutsSchema.parse(raw);
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
          await rename(temporary, this.path);
        } finally {
          await rm(temporary, { force: true });
        }
        this.value = value;
        return value;
      });
    this.queue = task;
    return task;
  }
}
