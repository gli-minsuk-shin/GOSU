import { z } from 'zod';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { SealedStateStore } from './sealed-state-store';
import { systemBriefingKey } from './briefing-system-key';
import type { AssistantProfile } from './briefing-workspace-store';
import { BriefingIntervalSchema, GenerationStatusSchema } from './src/briefing-generation-contract';
const RecordSchema = z
  .object({
    routineId: z.string().max(128),
    intervalHours: BriefingIntervalSchema,
    ownerToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    profileDigest: z.string().nullable(),
    nextDueAt: z.string().datetime().nullable(),
    scheduleError: z.string().max(1000).nullable(),
    job: GenerationStatusSchema.nullable(),
  })
  .strict();
const Schema = z
  .object({ version: z.literal(1), revision: z.number(), records: z.array(RecordSchema).max(100) })
  .strict();
export type GenerationRecord = z.infer<typeof RecordSchema>;
export const generationProfileDigest = (p: AssistantProfile) =>
  createHash('sha256')
    .update(
      JSON.stringify([p.timeZone, p.live, p.interest, p.preferences, p.approvedScope, p.owners]),
    )
    .digest('hex');
export class BriefingGenerationStore {
  private state: SealedStateStore<z.infer<typeof Schema>>;
  constructor(
    directory = join(homedir(), 'Library', 'Application Support', 'GOSU', 'briefing-lab'),
    key = systemBriefingKey,
  ) {
    this.state = new SealedStateStore(
      directory,
      {
        file: 'generation.v1.enc.json',
        version: 1,
        aad: 'gosu-briefing-generation-v1',
        empty: () => ({ version: 1, revision: 0, records: [] }),
        parse: (v) => Schema.parse(v),
      },
      key,
    );
  }
  async records() {
    return (await this.state.read()).records;
  }
  async record(routineId: string) {
    return (await this.records()).find((r) => r.routineId === routineId) ?? null;
  }
  async update(routineId: string, change: (r: GenerationRecord) => void, signal?: AbortSignal) {
    let result!: GenerationRecord;
    await this.state.mutate((state) => {
      let record = state.records.find((r) => r.routineId === routineId);
      if (!record) {
        record = {
          routineId,
          intervalHours: 0,
          ownerToken: null,
          profileDigest: null,
          nextDueAt: null,
          scheduleError: null,
          job: null,
        };
        state.records.push(record);
      }
      change(record);
      result = structuredClone(record);
    }, signal);
    return result;
  }
  async claim(routineId: string, now: number) {
    let claimed: GenerationRecord | null = null;
    await this.update(routineId, (r) => {
      if (r.intervalHours && r.nextDueAt && Date.parse(r.nextDueAt) <= now) {
        r.nextDueAt = new Date(now + r.intervalHours * 3600000).toISOString();
        claimed = structuredClone(r);
      }
    });
    return claimed as GenerationRecord | null;
  }
}
