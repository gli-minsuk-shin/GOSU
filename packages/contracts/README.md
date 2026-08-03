# `@gosu/contracts`

Versioned, language-neutral contracts shared by the GOSU desktop, sync service, web app, and Linux Runner.

## Source and generated artifacts

Zod schemas in `src/` are the authoring source. Committed Draft-07 JSON Schemas in `generated/json-schema/` are the canonical cross-language artifacts and must never be edited by hand.

```bash
pnpm --filter @gosu/contracts generate
pnpm --filter @gosu/contracts generate:check
```

`generate` builds the package and rewrites individual `.v1.schema.json` files, `index.json`, and the self-contained `gosu-contracts.v1.bundle.schema.json`. Unit tests perform the same deterministic drift check.

The bundle is the current Go generation boundary for the Runner. Automated Go struct generation is intentionally not included in this bootstrap: the Runner should validate wire data against these schemas until a pinned JSON-Schema-to-Go generator and compatibility tests are added. The bundle/index keeps that later generation step deterministic without claiming generated Go types already exist.

Runner control-plane events use `RunnerEventMessageV1`: a project-scoped
`runner.event` envelope containing a `RunnerEventV1`. Metric events explicitly
set `isSummary`; hosted services may persist summary metrics while treating
non-summary metric, log, and resource events as live relay data. Job manifests
reject secret-like parameter keys, values, and command arguments; workloads
must receive credentials only through approved `secretRefs`.
