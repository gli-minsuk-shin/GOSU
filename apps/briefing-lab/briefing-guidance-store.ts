import { z } from 'zod';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SealedStateStore } from './sealed-state-store';
import { systemBriefingKey } from './briefing-system-key';
import { secretPattern } from './briefing-memory-store';
import {
  BriefingGuidanceItemSchema,
  MAX_GUIDANCE_ITEMS,
  MAX_GUIDANCE_TEXT,
  normalizedGuidanceText,
  type BriefingGuidanceItem,
} from './src/briefing-guidance';

const Schema = z
  .object({
    version: z.literal(1),
    revision: z.number(),
    routines: z
      .array(
        z
          .object({
            routineId: z.string().max(128),
            items: z.array(BriefingGuidanceItemSchema).max(MAX_GUIDANCE_ITEMS),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

function validText(value: string) {
  const text = normalizedGuidanceText(value);
  if (!text || text.length > MAX_GUIDANCE_TEXT) throw new Error('briefing_guidance_text_invalid');
  if (secretPattern.test(text)) throw new Error('briefing_guidance_secret');
  return text;
}

/**
 * The user's standing instructions for AI summaries, per routine. Kept in its own sealed file, apart
 * from the routine profile, so editing them never changes the settings digest that pauses automatic
 * briefings, and an older GOSU simply ignores the file.
 */
export class BriefingGuidanceStore {
  private state: SealedStateStore<z.infer<typeof Schema>>;
  constructor(
    directory = join(homedir(), 'Library', 'Application Support', 'GOSU', 'briefing-lab'),
    key = systemBriefingKey,
  ) {
    this.state = new SealedStateStore(
      directory,
      {
        file: 'guidance.v1.enc.json',
        version: 1,
        aad: 'gosu-briefing-guidance-v1',
        empty: () => ({ version: 1, revision: 0, routines: [] }),
        parse: (v) => Schema.parse(v),
        maxBytes: 1_000_000,
      },
      key,
    );
  }
  async list(routineId: string): Promise<BriefingGuidanceItem[]> {
    return (await this.state.read()).routines.find((r) => r.routineId === routineId)?.items ?? [];
  }
  private change(routineId: string, fn: (items: BriefingGuidanceItem[]) => void) {
    return this.state.mutate((state) => {
      let routine = state.routines.find((r) => r.routineId === routineId);
      if (!routine) {
        routine = { routineId, items: [] };
        state.routines.push(routine);
      }
      fn(routine.items);
      return structuredClone(routine.items);
    });
  }
  async add(routineId: string, value: string) {
    const text = validText(value);
    return this.change(routineId, (items) => {
      if (items.length >= MAX_GUIDANCE_ITEMS) throw new Error('briefing_guidance_limit');
      const now = new Date().toISOString();
      items.push({ id: randomUUID(), text, createdAt: now, updatedAt: now });
    });
  }
  async edit(routineId: string, id: string, value: string) {
    const text = validText(value);
    return this.change(routineId, (items) => {
      const item = items.find((entry) => entry.id === id);
      if (!item) throw new Error('briefing_guidance_not_found');
      item.text = text;
      item.updatedAt = new Date().toISOString();
    });
  }
  async remove(routineId: string, id: string) {
    return this.change(routineId, (items) => {
      const index = items.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error('briefing_guidance_not_found');
      items.splice(index, 1);
    });
  }
}
