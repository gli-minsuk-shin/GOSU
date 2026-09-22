# Public paper lookup and source failure recovery

## Recurring Briefing recovery, 2026-09-14 (0.58.53)

The prior chat search did not change recurring collection. That missing wiring caused the reported
arXiv timeout to fail the entire paper source. The default collection now calls
[multi-source discovery](../apps/briefing-lab/briefing-paper-discovery.ts), independently querying
arXiv and the existing allowlisted Crossref/OpenReview indexes with 12-second deadlines.
arXiv retains its complete profile query, spacing and HTTP cooldown. Alternate indexes query the
two highest-weight keyword phrases (one request per phrase/provider), each at most 60 candidates.
This bounded coverage is disclosed, not represented as exhaustive literature search. Chat keeps
its own title/topic/identifier lookup and does not recursively invoke recurring discovery.

All candidates must have a reliable publication date inside the original window, match a weighted
keyword or synonym, pass the author/excluded-term filters, and retain source bibliographic evidence.
DOI metadata is not a full-paper read; OpenReview is not proof of peer review. Identical saved keys
are excluded before the display limit. Successful raw candidates are cached for two minutes and
re-filtered against current exclusions/dates. A partial cache cannot produce a false empty-success
after its known candidates are exhausted. No failures, private mail bodies or user settings are
invented/reset to make recovery look successful. HTTP cooldowns and TLS/DNS safety are unchanged.

No matching candidates plus an unavailable source remains incomplete, not confirmed zero. Valid
alternate candidates survive partial failure and can proceed through the existing AI summary flow.
Saved History remains intact; an empty failed source is labelled 조회 미완료.

API references: [Crossref date filters](https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-filters/)
and [OpenReview search](https://docs.openreview.net/reference/api-v2/openapi-definition).
Explicit public-only smoke: `tools/public-discovery-smoke.ts`, no mailbox/LLM/library writes.
See [0.58.53](releases/0.58.53.md) for actual tests, live evidence and installation status.

## General discovery update, 2026-09-14

Source candidate [0.58.39](releases/0.58.39.md) adds broad publisher DOI metadata through Crossref,
reusing Desktop's normalizer but retaining Briefing's pinned public-host transport. arXiv, Crossref
and OpenReview searches run concurrently with independent 12-second deadlines, preserve successful
results when another provider fails, and interleave result candidates. Search results require relevance
assessment; bibliographic type alone does not distinguish a research report from every editorial/review.
Only identical IDs are deduplicated; uncertain cross-provider versions are not silently merged.

Default mode is topic regardless of word count. Explicit title mode requires normalized exact titles,
recent mode retains the existing filters, and an explicit year filters rather than overwrites evidence.
DOI/DOI URL and arXiv ID/URL inputs resolve directly, without a fuzzy title search or date cutoff.
Crossref DOI registration timestamps are not publication dates; year-only dates stay undated for
recent search. Unsupported DOI registries, unknown arbitrary URLs, paywalls and challenges are not
promised to work. No registry credentials or source security settings are changed.

arXiv reads try public HTML then a title-checked PDF if necessary, including older articles without
HTML. DOI-based items can find an exact-title, overlapping-author OpenReview copy and known PMLR
publication; DataCite preprint discovery is also available. Version/coverage limitations remain visible.
Successful caches are title/identifier 24h, topic 10m and recent 2m; original-body cache is retained
when the same ID/title is rediscovered. These are in-process caches, not persistent library saves.
The existing recurring briefing arXiv/Scholar collection is not replaced by this chat-search change.
Tests cover arbitrary discipline titles, short titles/long topics, DOI identity, cancellation, stalled
providers, explicit years, incomplete dates, unsupported types and original PDF fallback.

Primary API reference: [Crossref REST API](https://github.com/CrossRef/rest-api-doc).
The following sections document the previous 0.58.38 implementation; the changes above supersede
its serial search order and title/topic cache duration where they differ.

Installed binary [0.58.38](releases/0.58.38.md), 2026-09-14; native UI confirmation awaits a suspected
macOS security/keychain prompt. This changes the AI assistant's named-paper
and topic lookup, not the user's recurring collection settings or private Mail/Calendar permissions.

## Search and reading are separate operations

`search_papers` accepts `mode=title|topic|recent`. Named titles are compared exactly after Unicode,
case, punctuation and whitespace normalization, preserving word boundaries. Title/topic lookup does
not inherit briefing age, author or excluded-topic filters. Recent discovery retains these filters;
fallback records without a reliable public date are not treated as recent. Existing recurring arXiv
collection keeps its original date and research filters.

The normal public arXiv query transport retains its request spacing and cache. On failure or no
matching title, independently search public OpenReview metadata; exact-title DataCite DOI metadata is
also available when needed. No API key, account cookie, private mailbox or transcript is transmitted.
Only a bounded public search query is sent. A failed provider is distinguished from a successful empty
result. Successful lookup evidence is cached with bounded capacity (24h for title/topic, 2m recent).

`read_public_paper` accepts only an ID observed by this assistant turn, never an arbitrary model URL.
It locates a PMLR volume using the observed venue/year, checks the exact title on the publication page,
then reads a same-paper public PDF. OpenReview PDFs are attempted only at allowlisted public PDF
paths. Verify the PDF's extracted opening title before using its text. If OpenReview redirects to
`/challenge`, report it and do not follow/solve/bypass the challenge.

Where available, exact-title DataCite metadata can identify a versioned arXiv preprint and its public
HTML article. This is an article-content read, not a repeated search-API request through another host
or IP. API cooldowns and per-host HTTP 429 cooldowns remain respected. Version differences between
preprint and submission/publication are explicit. No paper-specific title→URL hardcoding is used.

PDF extraction is capped at 20 MB and 60,000 text characters, with page coverage, character continuation and
coverage metadata. It does not extract scans/figures or claim a complete-paper read. Existing HTML
extraction retains 24,000 characters plus bounded source LaTeX and figure captions/links. Captions are
not visual inspection. The assistant can summarize available evidence using the five-section template,
mark unknown methods/results/limitations, and ask for uploads only when required evidence remains
unavailable after usable public routes. Original readings carry fetch time/cache status.

## Error provenance and transport safety

- Actual upstream HTTP 429: host/status/retry deadline and `phase=http`.
- GOSU cooldown: `phase=cooldown`, `requestSent=false`, no newly observed HTTP status.
- Local 20-second read deadline: `phase=timeout`, not proof of 429 or an IP ban.
- OpenReview verification redirect: `source_challenge_required`, observed HTTP 302.

Do not label historic cached failures as new network attempts. The minimum two-minute pause is not
a provider recovery promise. Fixed HTTPS hosts/routes, pinned public IPv4 DNS, certificate validation,
bounded responses and no redirect following remain. PMLR index/page/PDF, public OpenReview search/PDF
and DataCite DOI search are narrowly added; challenge/authentication/private routes stay denied.

## Live diagnostic evidence

On 2026-09-13 a real arXiv query using the GOSU transport returned a local timeout; another returned
HTTP 429. OpenReview title search returned both requested public records but its PDF paths redirected
to a challenge page. No challenge was solved or alternate IP used.

After correction, a read-only live fallback probe deliberately held the arXiv API in a simulated
cooldown to avoid resending it; all other requests used real public sources. It obtained the ICML
2023 PMLR PDF (24 pages, 15 processed within 60,000 characters) in about 2.0 seconds, and the second
paper's DOI-verified public HTML v1 (24,000 characters, 8 equations and 4 figure references) in about
2.1 seconds. These are source-access checks, not an LLM summary-quality or general latency benchmark.
No private data, model invocation or saved-paper library write was used in that probe.

Primary references: [OpenReview API](https://docs.openreview.net/reference/api-v2/openapi-definition),
[DataCite queries](https://support.datacite.org/docs/queries),
[PMLR](https://proceedings.mlr.press/). Follow the [release runbook](RELEASE_RUNBOOK.md) for installation.
