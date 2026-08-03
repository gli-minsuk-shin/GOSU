# GOSU

**Goal-Oriented Science, Unified** — a local-first workspace for planning experiments,
writing and reviewing papers, and coordinating research teams.

> [!IMPORTANT]
> GOSU is in early development. The repository currently contains the operational MVP
> foundation and interactive vertical slices, not a production deployment. Do not use it yet
> for private research data, production credentials, or unattended workloads.

## What GOSU is building

GOSU brings the research loop into one workspace:

- manage labs, projects, milestones, and Kanban work;
- define a measurable objective and run bounded experiments on a Linux runner;
- stream metrics without uploading raw datasets, logs, or artifacts to the sync service;
- write LaTeX, track evidence, review revisions, and export a pinned snapshot to Overleaf;
- connect GitHub, Zotero, and a read-only selection from an Obsidian vault;
- use Codex through a local provider adapter whose model catalog is discovered at runtime; and
- turn an approved manuscript revision into an editable, source-linked lecture draft.

The initial desktop target is macOS. Experiment workloads run in isolated Linux containers.

## Architecture

GOSU is a modular monorepo. Modules exchange versioned commands and events instead of reading
one another's persistence directly.

| Area                    | Responsibility                                                 |
| ----------------------- | -------------------------------------------------------------- |
| `apps/desktop`          | Local-first Electron application and privileged local adapters |
| `apps/web`              | Owner and lab administration web experience                    |
| `apps/sync-api`         | Collaboration API, authorization, audit, and event relay       |
| `apps/runner`           | Outbound-only Linux experiment runner                          |
| `packages/contracts`    | Authored TypeScript schemas and generated JSON Schema          |
| `packages/domain`       | Pure domain rules and state transitions                        |
| `packages/ui`           | Shared presentational components and design tokens             |
| `packages/integrations` | Provider and connector ports plus implementations              |

The hosted service stores collaboration state, not research payloads. GitHub remains the source
of truth for code and manuscripts; Obsidian and Zotero remain the source of truth for their own
content; datasets, raw logs, checkpoints, and artifacts remain on the runner.

## Current bootstrap status

The repository implements the security and domain foundation, but its components are not yet a
deployed end-to-end product:

- the Owner Web app is an interactive, responsive product slice backed by deterministic demo
  fixtures;
- the Electron app provides a sandboxed renderer, encrypted local state, a read-only Obsidian
  reader, and local Codex App Server integration with runtime model discovery;
- the running Sync API uses an in-memory development store with lab/project authorization,
  optimistic versions, idempotency, SSE, and a non-persistent WebSocket relay;
- a PostgreSQL schema and tested persistence adapter implement tenant context, transactional
  outbox, audit, approval, version, idempotency, and hosted-payload checks, but that adapter is not
  yet selected by the Nest application at runtime; and
- the Linux runner and integration packages provide isolated execution and connector foundations,
  with production enrollment and external service provisioning still to be completed.

Google/Apple login orchestration, production PostgreSQL/Redis wiring, cloud deployment, macOS
signing/notarization, auto-update, and the complete cross-application E2E flow remain operational
work. See each application README for its exact runnable boundary.

## Trust boundaries

- Electron renderers are sandboxed and have no direct Node.js, filesystem, Git, SSH, Keychain,
  or Codex access. A typed IPC allowlist mediates local capabilities.
- API keys, OAuth tokens, SSH material, and runner secrets must stay in the macOS Keychain or the
  runner's secret store. They must never enter Git, sync events, manifests, or telemetry.
- Runner jobs are non-root, resource-limited, read-only by default, and network-denied unless an
  approved manifest grants a narrower capability.
- AI changes are represented as reviewable patches or staging commits. Protected branches,
  evidence acceptance, and exports remain human approval points.

These are required trust boundaries. The development authentication mode and the demo applications
are not substitutes for production identity, mTLS, deployment isolation, or external-service
authorization.

See [SECURITY.md](SECURITY.md) for reporting and operational security guidance.

## Development

### Prerequisites

- Node.js 22 or newer
- pnpm 11 (managed through Corepack)
- Docker with Compose v2 when developing the PostgreSQL/Redis adapters
- Go and Python versions specified by their workspace components when working on the runner

### Start locally

```bash
corepack enable
cp .env.example .env
pnpm install
pnpm dev
```

The values in `.env.example` are local-only placeholders. Never copy production credentials into
the repository or commit a populated `.env` file. The default Sync API does not require Docker and
loses its in-memory state on restart. `docker compose up -d` starts PostgreSQL and Redis for adapter
development; it does not switch the running API to PostgreSQL automatically.

### Common commands

```bash
pnpm dev           # run workspace development tasks
pnpm build         # build all packages and applications
pnpm lint          # lint all workspaces
pnpm typecheck     # run TypeScript checks
pnpm test          # run workspace test suites once
pnpm format:check  # verify formatting without changing files
pnpm check         # run the complete local quality gate
```

Turbo handles task ordering and caching. Run a single workspace with pnpm's filter syntax, for
example `pnpm --filter @gosu/contracts test`.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Contributions are accepted
under the Apache License 2.0. Security reports must follow [SECURITY.md](SECURITY.md), not a public
issue.

## License

Copyright 2026 GOSU contributors.

Licensed under the [Apache License 2.0](LICENSE).
