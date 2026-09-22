import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApprovalPolicySchema, type ApprovalPolicy } from '../shared/approval-policy';
/** App-owned preference, not a new source grant. Fail closed until initialized. */
export class ApprovalPolicyStore {
  private blockedScopes: string[] = [];
  private value: ApprovalPolicy | undefined;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  enabled = (scopeId?: string) =>
    this.value?.reuseApprovedScopes === true && (!scopeId || !this.blockedScopes.includes(scopeId));
  async load() {
    try {
      const stored = ApprovalPolicySchema.extend({
        blockedScopes: z.array(z.string().uuid()).max(10000).default([]),
      }).parse(JSON.parse(await readFile(this.path, 'utf8')));
      this.blockedScopes = stored.blockedScopes;
      this.value = { version: 1, reuseApprovedScopes: stored.reuseApprovedScopes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.value = undefined;
        throw new Error('approval_policy_unreadable', { cause: error });
      }
      await this.set({ version: 1, reuseApprovedScopes: true });
    }
    return this.get();
  }
  get() {
    if (!this.value) throw new Error('approval_policy_unavailable');
    return { ...this.value };
  }
  async revokeScope(id: string) {
    z.string().uuid().parse(id);
    if (!this.blockedScopes.includes(id)) this.blockedScopes.push(id);
    const operation = this.pending
      .catch(() => undefined)
      .then(() => this.persist(this.get()))
      .catch((error) => {
        this.value = undefined;
        throw error;
      });
    this.pending = operation;
    await operation;
  }
  set(raw: unknown) {
    const next = ApprovalPolicySchema.parse(raw);
    const operation = this.pending.catch(() => undefined).then(() => this.persist(next));
    this.pending = operation;
    return operation;
  }
  private async persist(next: ApprovalPolicy) {
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      await writeFile(tmp, JSON.stringify({ ...next, blockedScopes: this.blockedScopes }), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(tmp, this.path);
      this.value = next;
      return this.get();
    } finally {
      await rm(tmp, { force: true });
    }
  }
}
