import { z } from 'zod';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { SealedStateStore } from './sealed-state-store';
import { systemBriefingKey } from './briefing-system-key';
import type { AssistantProfile } from './briefing-workspace-store';
import { BriefingScheduleSchema, nextOccurrences } from '@gosu/briefing-core';
import { BriefingIntervalSchema, GenerationStatusSchema } from './src/briefing-generation-contract';
const RecordSchema = z
  .object({
    routineId: z.string().max(128),
    intervalHours: BriefingIntervalSchema,
    /** The routine's own delivery times; the briefing also runs at those clock times. */
    routineSchedule: BriefingScheduleSchema.nullable().default(null),
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

/**
 * When the next automatic briefing is due: the routine's next delivery time, the saved interval
 * after `now`, or whichever of the two comes first. A time that passed while the Mac was asleep or
 * GOSU was closed is already behind `now`, so the next run happens once, on the next check.
 */
export function nextGenerationDueAt(
  record: Pick<GenerationRecord, 'intervalHours' | 'routineSchedule'>,
  now: number,
): string | null {
  const due: string[] = [];
  if (record.intervalHours) due.push(new Date(now + record.intervalHours * 3600000).toISOString());
  if (record.routineSchedule) {
    const occurrence = nextOccurrences(record.routineSchedule, new Date(now).toISOString(), 1)[0];
    if (occurrence) due.push(occurrence.scheduledFor);
  }
  return due.sort().at(0) ?? null;
}

/** Whether anything at all runs this routine automatically. */
export function generationScheduled(
  record: Pick<GenerationRecord, 'intervalHours' | 'routineSchedule'>,
) {
  return Boolean(record.intervalHours || record.routineSchedule);
}
export const generationProfileDigest = (p: AssistantProfile) =>
  'v2:' +
  createHash('sha256')
    .update(
      JSON.stringify([
        p.routineId,
        p.approvedScope,
        p.live.mail,
        p.preferences.providerId,
        p.preferences.mailRead,
        p.preferences.mailAi,
        p.preferences.calendarRead,
        [...p.preferences.calendarIds].sort(),
        !!p.preferences.todoRead,
        !!p.preferences.projectRead,
      ]),
    )
    .digest('hex');
const legacyDigest = (p: AssistantProfile) =>
  createHash('sha256')
    .update(
      JSON.stringify([p.timeZone, p.live, p.interest, p.preferences, p.approvedScope, p.owners]),
    )
    .digest('hex');
export const generationRunDigest = (p: AssistantProfile) =>
  createHash('sha256')
    .update(JSON.stringify([p.timeZone, p.live, p.interest, p.preferences, p.approvedScope]))
    .digest('hex');
/** Only migrate an exact old configuration; additional authorized clients are not a scope change. */
export function generationProfileMatches(p: AssistantProfile, record: GenerationRecord) {
  if (record.profileDigest === generationProfileDigest(p)) return true;
  if (!record.ownerToken || record.profileDigest?.startsWith('v2:')) return false;
  const owner = createHash('sha256').update(record.ownerToken).digest('hex');
  return p.owners.some((_, i) => {
    const owners = p.owners.slice(0, i + 1);
    return owners.includes(owner) && legacyDigest({ ...p, owners }) === record.profileDigest;
  });
}
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
          routineSchedule: null,
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
      if (generationScheduled(r) && r.nextDueAt && Date.parse(r.nextDueAt) <= now) {
        r.nextDueAt = nextGenerationDueAt(r, now);
        claimed = structuredClone(r);
      }
    });
    return claimed as GenerationRecord | null;
  }
}
