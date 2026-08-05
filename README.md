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

The repository implements the security and domain foundation and a runnable local desktop slice,
but it is not yet a deployed end-to-end product:

- the Owner Web app is an interactive, responsive product slice backed by deterministic demo
  fixtures;
- the Electron app provides a usable local workspace: users can navigate project folders, customize
  Kanban boards, manage versioned tasks, and save, freeze, and explicitly revise goal/metric
  definitions. Those records and an offline change outbox are committed atomically to encrypted
  SQLite and survive an app restart;
- Project Chat uses the local Codex App Server with runtime-discovered model, reasoning, and native
  harness catalogs. Its project-scoped read tools can inspect reviewed Board, Objective, and
  explicitly granted Local Notes context without exposing raw filesystem paths;
- Connections can safely parse a narrow pasted SSH command into a local profile without executing
  or retaining the original text. Each project can separately grant one remote workspace root;
  Project Chat can inspect Git and request bounded tests/builds only after an exact `Allow once`
  approval. Imported `-L` forwarding remains an inactive plan;
- the read-only Obsidian reader renders sanitized Markdown, and each project has an app-managed
  Repository workspace for GitHub HTTPS clone, file tree and Markdown preview, staged/unstaged diff,
  commit history, local branches, commit, Fetch, fast-forward-only Pull, and reviewed-SHA-only
  non-force Push; and
- the running Sync API uses an in-memory development store with lab/project authorization,
  optimistic versions, idempotency, SSE, and a non-persistent WebSocket relay;
- a PostgreSQL schema and tested persistence adapter implement tenant context, transactional
  outbox, audit, approval, version, idempotency, and hosted-payload checks, but that adapter is not
  yet selected by the Nest application at runtime; and
- the Linux runner and integration packages provide isolated execution and connector foundations,
  with production enrollment and external service provisioning still to be completed.

Google/Apple login orchestration, production PostgreSQL/Redis wiring, cloud deployment, macOS
signing/notarization, auto-update, and the complete cross-application E2E flow remain operational
work. The Desktop outbox is not delivered to Hosted Sync yet, so its pending count means “stored
locally for later synchronization”, not “synchronized”. See each application README for its exact
runnable boundary.

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

See [the architecture and maintenance guide](docs/ARCHITECTURE.md) for module ownership and safe
change recipes, and [SECURITY.md](SECURITY.md) for reporting and operational security guidance.

## Development

### Prerequisites

- Node.js 22 or newer
- pnpm 11 (managed through Corepack)
- Apple Command Line Tools (`git`) for the project Repository workspace on macOS
- Docker with Compose v2 when developing the PostgreSQL/Redis adapters
- Go and Python versions specified by their workspace components when working on the runner

### Run the local desktop app

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm app:doctor
pnpm app:dev
```

`app:dev` starts the loopback-only in-memory Sync API, waits for its readiness endpoint, and then
opens the Electron app. `Ctrl+C` stops the process group. A healthy GOSU Sync process already using
the configured port is reused; an unrelated process on that port is rejected. No `.env` file or
Docker service is required for this local slice. Project, Kanban, and goal/metric data are stored in
the Desktop's encrypted local database and survive restart. App-managed Git worktrees remain only
under the Desktop user-data directory and are not uploaded to Hosted Sync. The development Sync
API's own memory state is separate and is lost on restart.

To build a local macOS installer after running the complete quality gate:

```bash
pnpm app:package
```

The resulting DMG under `apps/desktop/dist` is an ad-hoc-signed development artifact. Public
distribution still requires Developer ID signing, notarization, update metadata, and a clean-machine
release test.

The values in `.env.example` are local-only placeholders. Never copy production credentials into
the repository or commit a populated `.env` file. `docker compose up -d` starts PostgreSQL and Redis
for adapter development; it does not switch the running API to PostgreSQL automatically.

### Common commands

```bash
pnpm dev           # run workspace development tasks
pnpm app:dev       # start Sync, wait for readiness, and open Electron
pnpm app:doctor    # validate the local desktop prerequisites
pnpm app:package   # run all checks and create an ad-hoc-signed local DMG
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
