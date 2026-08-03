import { z } from 'zod';

const zoteroItemSchema = z.object({
  key: z.string(),
  version: z.number().int(),
  data: z
    .object({
      itemType: z.string(),
      title: z.string().default(''),
      DOI: z.string().optional(),
      url: z.string().optional(),
      date: z.string().optional(),
      creators: z
        .array(
          z.object({
            firstName: z.string().optional(),
            lastName: z.string().optional(),
            name: z.string().optional(),
            creatorType: z.string(),
          }),
        )
        .default([]),
      tags: z.array(z.object({ tag: z.string() })).default([]),
      collections: z.array(z.string()).default([]),
    })
    .passthrough(),
});

export type ZoteroItem = z.infer<typeof zoteroItemSchema>;

export class ZoteroReadOnlyClient {
  constructor(
    private readonly library: { type: 'users' | 'groups'; id: string },
    private readonly apiKey: () => Promise<string>,
    private readonly apiBase = 'https://api.zotero.org',
  ) {}

  async items(input: { since?: number; limit?: number } = {}) {
    const url = new URL(
      `${this.apiBase}/${this.library.type}/${encodeURIComponent(this.library.id)}/items`,
    );
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(Math.min(input.limit ?? 100, 100)));
    if (input.since !== undefined) url.searchParams.set('since', String(input.since));
    const response = await fetch(url, {
      headers: { 'Zotero-API-Version': '3', 'Zotero-API-Key': await this.apiKey() },
    });
    if (!response.ok) throw new Error(`zotero_request_failed:${response.status}`);
    const items = z.array(zoteroItemSchema).parse(await response.json());
    return {
      items,
      libraryVersion: Number(response.headers.get('Last-Modified-Version') ?? input.since ?? 0),
    };
  }

  /** Deliberately no write or attachment method in the MVP connector. */
  citationRecord(item: ZoteroItem) {
    return {
      provider: 'zotero' as const,
      libraryType: this.library.type,
      libraryId: this.library.id,
      itemKey: item.key,
      version: item.version,
      title: item.data.title,
      doi: item.data.DOI ?? null,
      verification: item.data.DOI ? ('metadata_verified' as const) : ('metadata_only' as const),
    };
  }
}
