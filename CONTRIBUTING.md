# Contributing to GOSU

Thank you for helping build GOSU. This project handles research code, credentials, and potentially
expensive compute, so correctness and explicit trust boundaries matter as much as features.

## Before you start

- Search existing issues and pull requests before proposing overlapping work.
- Use a focused branch from `main`; keep unrelated refactors out of the same pull request.
- Discuss architecture changes, new hosted data, new network access, or privileged runner
  capabilities in an issue before implementation.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Local setup

Requirements are Node.js 22+ and pnpm 11 through Corepack. Docker Compose v2 is needed for
PostgreSQL/Redis adapter work; Go and Python are needed for Runner work.

```bash
corepack enable
cp .env.example .env
pnpm install
pnpm check
```

The default Sync API uses an in-memory store, so Docker is not required for the workspace quality
gate. Starting PostgreSQL and Redis does not switch the application persistence mode; read
`apps/sync-api/README.md` before changing or testing that boundary.

Use placeholder or synthetic data in development. Never place real API keys, OAuth tokens, SSH
addresses, private paper text, unpublished results, datasets, logs, or checkpoints in fixtures.

## Engineering rules

- Keep Identity & Lab, Project & Kanban, Goal & Evaluation, Experiment, Manuscript, Review,
  Reference, Knowledge, Lecture, AI Gateway, Integration, and Sync/Audit modules isolated.
- A module owns its persistence. Cross-module behavior goes through a typed port or a versioned
  command/event contract in `packages/contracts`.
- Make state transitions deterministic and test them in `packages/domain` before wiring I/O.
- Treat model identifiers as opaque provider data; do not hardcode a catalog into product UI.
- Preserve provenance. Failed, cancelled, and negative experiments are records, not disposable
  errors.
- Never log or synchronize secrets, raw research payloads, hidden AI tool payloads, or shell
  output.
- Do not bypass sandbox, authorization, approval, budget, network, mount, or Git base-SHA checks,
  including in tests and development helpers.

## Code style and checks

Shared TypeScript, ESLint, and Prettier defaults live at the repository root. A workspace may
extend them when its runtime requires narrower settings.

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Add tests for new behavior and for failure modes at each trust boundary. Integration changes need
fixtures that are clearly fake and deterministic. Do not update generated JSON Schemas by hand;
regenerate and verify them with:

```bash
pnpm --filter @gosu/contracts generate
pnpm --filter @gosu/contracts generate:check
```

## Pull requests

A pull request should:

1. explain the user-visible outcome and security/privacy impact;
2. link the relevant issue or design discussion when one exists;
3. include tests or explain why no test applies;
4. update documentation and example configuration when behavior changes; and
5. pass formatting, lint, typecheck, test, build, dependency review, and secret scanning checks.

At least one code owner must review changes. Authors must not merge with unresolved review
findings or a failing required check. Prefer small commits with descriptive imperative subjects;
squash or reword noisy work-in-progress history before merge when useful.

## Licensing

Unless explicitly stated otherwise, contributions intentionally submitted to this repository are
licensed under the Apache License 2.0, as described in [LICENSE](LICENSE).
