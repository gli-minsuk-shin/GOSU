# GOSU Desktop

The Electron main process owns all privileged local capabilities. The renderer
has no Node.js integration and can only call the explicitly allowlisted preload
API.

## Codex

`GOSU_CODEX_BIN` may point to a compatible Codex executable. Without the
override the app starts `codex app-server --listen stdio://`, performs the
official initialize handshake, and discovers models at runtime through
`model/list`. ChatGPT and API-key authentication remain in the local Codex
credential store. The child receives a minimal environment allowlist rather
than the Electron Main process environment, and startup is single-flight so no
request can race the initialize handshake.

## Local data

Workspace state and the offline outbox live in a ciphered SQLite database. Its random key is sealed
with Electron `safeStorage`, which uses the macOS Keychain. A project, task, or objective mutation
updates the versioned workspace snapshot and appends its idempotent outbox operation in one SQL
transaction. A failed commit publishes neither change. Task and objective updates require the
caller's expected entity version instead of silently applying last-write-wins.

Obsidian access is read-only, ignores symlinks, enforces the selected root, and rejects files other
than bounded Markdown documents. Navigation and privileged IPC are accepted only from the exact
packaged renderer URL or an explicit-port loopback development origin and its main frame. Packaged
builds ignore development URL environment overrides.

## Runnable local slice

From the repository root, `pnpm app:dev` starts the loopback development Sync API, waits for the
versioned readiness endpoint, and then opens Electron. `pnpm app:doctor` checks prerequisites without
starting Codex or reading credentials. On first launch the renderer starts with an empty workspace
and supports:

- creating and switching between multiple projects;
- creating, renaming, and moving tasks across `Backlog / Planned / In Progress / Review / Done`;
- defining a goal, primary metric, lineage hashes, budget, and stop policy;
- freezing an objective revision locally and explicitly starting the next version; and
- showing the number of durable changes waiting in the local outbox.

These records survive an app restart. The pending-change count does not claim cloud delivery: a
Sync delivery/reconciliation worker and multi-user authorization are not connected to this local
workspace yet. The Sync readiness indicator only reports whether the development API can be
reached. The remaining research modules are visibly marked as later work rather than populated with
simulated experiment or manuscript results.

The macOS-only storage smoke test runs inside Electron so the native SQLCipher module, `safeStorage`,
close/reopen recovery, encrypted file header, and transaction rollback are exercised with their
actual runtime ABI:

```bash
pnpm --filter @gosu/desktop smoke:local-db:mac
```

It creates and removes an isolated temporary user-data directory. It is intentionally separate from
the cross-platform Vitest suite.

The Desktop accepts `GOSU_SYNC_API_URL` as a credential-free base URL. Plain HTTP is limited to
loopback; a remote endpoint must use HTTPS. Electron Main appends the fixed readiness path, rejects
redirects, bounds the request timeout, validates the GOSU health identity, and returns only a small
ready/degraded result over IPC.

`pnpm app:package` runs the complete repository gate and creates an ad-hoc-signed development DMG.
The local-only packaging command disables Hardened Runtime so Electron and its native modules share
a valid development signature without weakening the production signing configuration. The packaged
renderer keeps the strict production CSP; only the exact Vite development origin receives
the inline refresh and HMR exceptions required for local development. Signing, notarization, update
metadata, and clean-machine release validation remain release work. The packaging hook also removes
Electron's unused camera, microphone, audio, and Bluetooth usage descriptions and replaces arbitrary
transport access with the explicit loopback development exception.

Because an ad-hoc signature has no stable Developer ID requirement, macOS can ask the user to allow
access to the existing `Electron Safe Storage` Keychain item after installing a rebuilt development
app. This prompt must be approved by the user; the packaging flow must not weaken or rewrite the
Keychain access policy to suppress it.

`pnpm app:package:release` keeps Hardened Runtime enabled and fails closed when a signing identity is
unavailable. It is the release entry point; Developer ID credentials and notarization configuration
must be supplied by the release environment.
