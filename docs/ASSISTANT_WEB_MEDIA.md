# Assistant public web and media

0.58.74 enables live native web search only for assistant structured jobs. Routine builders,
summary generation and other jobs retain disabled search by default. Codex already supports this
thread configuration; Claude receives only WebSearch/WebFetch in addition to the existing scoped MCP
tools when explicitly live. No shell, arbitrary file tool, unrestricted MCP or bypassPermissions is
enabled. Existing private AI/owner/provider checks remain in place for assistant calls.

The shared Markdown component previously removed links and images. Assistant messages now opt into
HTTPS source links, click-to-load images, and click-to-load OpenStreetMap coordinate-link previews.
User messages and summary cards retain their original non-interactive Markdown policy. Local/IP,
credential-bearing, non-HTTPS and malformed links are rejected. Remote media is not fetched on chat
restoration. Images use no-referrer and a bounded display size. Map frames use a fixed OSM endpoint,
validated finite coordinates, a bounded box and attribution, not arbitrary iframe HTML.
This is display, not proof the AI visually inspected an image or verified an indoor room.

The assistant's `search_images` tool queries only Wikimedia Commons (four results), preserving real
image/source URLs and attribution/license metadata. Metadata markup is stripped. Responses are
bounded to 256KB, redirects refused, timeout 12s, no automatic retry, 429 cooldown 10 minutes.
Public-query results are cached in memory for ten minutes with a 100-query cap; the process enforces
a one-second request interval. No new API credentials or third-party search subscriptions are added.
Zero Commons results is not a claim that the whole web has no image. The native web tool can locate
other public source images. Search only minimal public terms, never copied private mail/history.

Map coordinates must be supported by searched evidence; ambiguous schools/campuses need clarification.
This does not add the public Nominatim API or automatic geocoding. It does not generate fake map
images. Users can open cited source links when a preview is blocked/unavailable.

Sources consulted: [Codex configuration](https://developers.openai.com/codex/config-reference/),
[App Server events](https://developers.openai.com/codex/app-server/),
[Claude CLI](https://code.claude.com/docs/en/cli-usage),
[MediaWiki imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo),
[Nominatim restrictions](https://operations.osmfoundation.org/policies/nominatim/).

Live synthetic Codex smoke observed four actual webSearch events with GPT-6 Astra/low and an official
source URL. Live Commons verification caught a current `thumb.wikimedia.org` thumbnail host that
the initial allowlist excluded; both official thumbnail/original hosts are now covered by regression.
A subsequent public university image query returned four actual images with source and license metadata.
The visual fixture loaded an actual OSM map and an example Wikimedia image only after
clicks; no private data was used. Claude live account execution is not claimed by adapter unit tests.
See [release verification](releases/0.58.74.md) for gates and installed status.
