# Briefing latency benchmark — 2026-09-10

## Scope and result

Requested model: **gpt-5.6-luna**, reasoning **medium**, verified against the native GOSU Codex
catalog and each returned invocation. No model substitution, API-key fallback, real Mail/Calendar
reads, user-memory reads or persistent preference changes. All evidence was synthetic, but the
LLM invocations and measured times were real. Existing application summary caches were excluded
from these new-generation measurements; their production reuse behavior is unchanged.

Measurement window: September 10, 2026, 17:21–17:29 Asia/Seoul. Three source-specific cases,
baseline and optimized, three repetitions each: **18 native calls**. The metric starts at the native
runner invocation and ends after return/JSON parsing, including its catalog/thread lifecycle.
It is **not** end-to-end browser + Apple Mail/Calendar latency.

| Case                  | Before median | After median |          Time reduction | Before/after output-token median | Core checks before → after |
| --------------------- | ------------: | -----------: | ----------------------: | -------------------------------: | -------------------------- |
| Three-email summary   |      18.953 s |     19.091 s | **−0.7%: not improved** |                        638 → 511 | 3/3 → 3/3                  |
| Important-email chat  |      19.065 s |     16.148 s |                   15.3% |                        484 → 435 | 3/3 → 3/3                  |
| Two-day calendar chat |      20.142 s |     12.984 s |                   35.5% |                        589 → 266 | 0/3 → 3/3                  |

The email-summary mean moved 19.046 → 18.841 seconds (+1.1% improvement), whereas its median
did not improve. Optimized range was 15.433–21.999 seconds. Report **no confirmed email-summary
speedup**, not whichever statistic looks better. Output-token median fell 19.9%; shorter JSON
does not guarantee lower wall time. Its first-model-output median increased 8.761 → 11.589 seconds,
while first-output-to-return median decreased 10.154 → 7.502 seconds. Provider queue/prefill/network
contributions are not separately observable here. First-model-output is not visible UI answer time.

Baseline calendar replies omitted September 11 in repetitions 1/2 (the exclusive `to` boundary was
confirmed from repetition 2 tool arguments), and copied existing events into proposal arrays in
repetitions 1/3. Optimized replies included all three existing events and empty proposal arrays in
all three trials. The log check named `noWrites` means empty proposal arrays, **not** observed
Calendar mutations: neither variant had a write operation. This is a bounded task-specific rubric,
not general factual accuracy certification or an estimate of population accuracy.

## Implemented prompt and output changes

- `briefing-email-generation.ts`: EMAIL-only instructions and seven required generated fields
  (`id`, `summary`, `importance`, `importanceReason`, `action`, `evidenceQuote`, `memorySuggestion`).
  The prior shared schema required 18 fields including paper-only empty values. The host restores
  empty paper fields to preserve the existing API/history/UI contract. Paper/mixed analysis retains
  its five-section contract. Valid legacy full-shape email responses remain readable in flight.
- The email prompt preserves practical actions, explicit dates, uncertainty, literal evidence and
  private-memory restrictions, while removing paper analysis and repetitive overview/field prose.
  IDs/quotes remain validated; at most one corrective inference with a fresh permission check.
- `briefing-assistant.ts`: stop after sufficient grounded reads; avoid irrelevant Calendar lookup
  for ordinary mail questions; use compact, source-specific answer layouts without dropping
  account/receipt/deadline facts. Tool list and permissions remain unchanged.
- Existing schedule lists belong in `answer`; `events`/`tasks` are new proposals only, and must be
  empty for read-only questions. Calendar tool descriptions explicitly define inclusive `from`,
  exclusive `to`, and day D+1 as the bound when the user requests all of day D.
- Shared GOSU policy, scientific paper summaries, encrypted storage, feedback revision, exact-input
  cache validity, native provider selection and user's saved model/reasoning were not changed.

The public guidance supports minimizing unnecessary output/requests while preserving required
facts, but its general estimates are **not** used as this app's measured effect:
[OpenAI latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization),
[GPT-5.6 prompting guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6).
The exact requested [Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
supports medium reasoning; actual availability was additionally verified locally.

## Reproducibility and quality audit

Controlling artifacts under `tmp/briefing-latency-2026-09-10/`:

- `baseline-jobs.json`: frozen pre-change prompts/schemas, source hashes and fixed source input.
- `optimized-jobs.json`: executed optimized prompt/schema snapshot.
- `trials.jsonl`: all 18 native measurements, provider token/cache counts, synthetic outputs,
  invocation model/reasoning and rubric results. No hidden reasoning text was stored.
- `analysis.json`: descriptive statistics and matched-repetition changes.
- `compare.sql`, `trials.sql`, `verified-datasets.json`: independent raw-trial SQLite aggregation.
- `artifact.json`: full Data Analytics report manifest/snapshot; one grouped horizontal bar chart
  compares seconds across the three cases and two conditions, with explicit legend/units and zero
  baseline. Tables retain all six aggregates and all 18 trial rows. No trend or confidence band is
  drawn from only three repetitions. Report audience is technical; metric definitions precede the
  evidence chart so the exclusions cannot be missed.

The benchmark script is `apps/briefing-lab/tools/briefing-latency-benchmark.ts`. It captures the
application's real structured jobs and uses the real native transport with synthetic tool handlers.
The time for mock source operations was recorded but is not representative of OS source reads.
Baseline repetition 1 preceded changes; repetition 2 used optimized→baseline, repetition 3 used
baseline→optimized within each case. Every result, including baseline quality failures, is retained.
This is sequential, small-sample engineering evidence, not randomized production traffic.

Offline recalculation, without native inference:

```sh
node apps/briefing-lab/tools/analyze-briefing-latency.mjs
node apps/briefing-lab/tools/verify-latency-sql.mjs
```

The SQL verifier creates only an in-memory database from the raw trial log. **54 aggregate checks**
matched the independently computed JavaScript results. All recorded model/reasoning values match;
within-condition prompt hashes were stable. The native input/cache-token distributions differ, so
the measured deltas cannot isolate prompting from provider caching or upstream scheduling.

For an explicitly authorized new live benchmark, bundle the TypeScript script with esbuild, use
a **new** `BRIEFING_LATENCY_OUTPUT_DIR`, capture before edits, run `baseline`, then `compare` after
edits. Both inference modes require `BRIEFING_LATENCY_LIVE=1`. Capture uses create-only snapshots;
do not overwrite this benchmark or append a duplicate repetition to its log. A run costs native
subscription usage; its output-token changes are not converted to monetary billing savings.

## Verification and remaining limits

- Focused prompt/schema/assistant regression: **22/22**; full Briefing **435/435** (62 files).
- Named Agent Runtime: **177 Desktop + 251 Briefing = 428/428**. Typecheck, lint, formatting and
  production build passed. The backend was restarted after confirming only its esbuild child and
  no active external connection/LLM worker. Stored data and preferences were not reset; ephemeral
  source receipts expire normally. UI assets are unchanged (`index-DdihslK7.js`, `index-DMGItzBe.css`).
- Data Analytics payload validation passed and the MCP report renderer returned success. Direct
  visual inspection inside Codex was blocked by the computer-use app safety boundary; no claim of
  screenshot/UI visual QA is made. This is a report-display verification gap, not missing benchmark
  data. Analysis was reviewed with the Metric Diagnostics and Validate Data workflows; the negative
  email-summary finding, cache variation and small sample were retained.
- Real Apple Mail/Calendar cold-start/lookup latency, long messages, more accounts and broader
  question quality remain unmeasured. Follow-up should instrument those stages without storing
  private contents before attempting source caching or persistent transport changes. Never reuse
  stale private reads across revoked grants or silently weaken source freshness for speed.
