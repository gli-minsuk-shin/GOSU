import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
const Entry = z.object({
  slug: z.string(),
  context_window: z.number().int().positive().max(2_000_000).nullable().optional(),
  max_context_window: z.number().int().positive().max(2_000_000).nullable().optional(),
  effective_context_window_percent: z.number().int().min(1).max(100).nullable().optional(),
});
const Metadata = z.object({ fetched_at: z.string(), models: z.array(z.unknown()).max(500) });
/** Read only bounded provider model metadata from the GOSU native home; never auth/config text. */
export async function readCodexContextMetadata(home: string | undefined) {
  if (!home) return [];
  try {
    const file = await open(
      join(home, 'models_cache.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2_000_000) return [];
      const parsed = Metadata.parse(JSON.parse(await file.readFile('utf8')));
      const age = Date.now() - Date.parse(parsed.fetched_at);
      if (!Number.isFinite(age) || age < -60000 || age > 86400000) return [];
      return parsed.models.flatMap((value) => {
        const entry = Entry.safeParse(value);
        return entry.success ? [entry.data] : [];
      });
    } finally {
      await file.close();
    }
  } catch {
    return [];
  }
}
