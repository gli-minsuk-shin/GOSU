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

Research Notes connects one Obsidian Vault and creates an owned `GOSU/<project>` folder with
Literature, Papers, Experiments, Project Progress, and Idea Development sections. General Vault
content stays read-only. GOSU writes only initial templates, its deterministic Literature table,
and one-time paper-note drafts inside the owned project folder. Project-scoped IPC rejects symlinks,
root escape, stale binding and ownership changes; the Renderer has no Vault-wide filesystem bridge.
Navigation and privileged IPC are accepted only from the exact packaged renderer URL or an
explicit-port loopback development origin and its main frame. Packaged builds ignore development
URL environment overrides.

## Runnable local slice

From the repository root, `pnpm app:dev` starts the loopback development Sync API, waits for the
versioned readiness endpoint, and then opens Electron. `pnpm app:doctor` checks prerequisites without
starting Codex or reading credentials. On first launch the renderer starts with an empty workspace
and supports:

- creating and switching between multiple projects;
- creating, renaming, and moving tasks across `Backlog / Planned / In Progress / Review / Done`;
- defining a goal, primary metric, lineage hashes, budget, and stop policy;
- freezing an objective revision locally and explicitly starting the next version;
- browsing each project's managed Obsidian Research Notes tree as rendered, sanitized Markdown;
- projecting Literature searches into `Literature Review.md` and creating non-overwritten paper notes;
- using project-scoped Codex chats with runtime-discovered models, reasoning, and native modes;
- inspecting an app-managed Git workspace and reviewing its branches, history, and changes;
- building and incrementally updating a project literature review table;
- registering a safely parsed SSH destination and granting a remote workspace root to one project;
- monitoring registered server CPU, memory, and GPU usage with collapsible status cards and a local
  refresh preference; and
- showing the number of durable changes waiting in the local outbox.

These records survive an app restart. The pending-change count does not claim cloud delivery: a
Sync delivery/reconciliation worker and multi-user authorization are not connected to this local
workspace yet. The Sync readiness indicator only reports whether the development API can be
reached. The remaining research modules are visibly marked as later work rather than populated with
simulated experiment or manuscript results.

## Project Chat remote workspace

In Connections, paste a connection command such as
`ssh -p 2222 researcher@203.0.113.10 -L 8080:localhost:8080` into **Paste an SSH connection
command**, then select **Parse and register**. A deterministic local parser normalizes the supported
destination fields; neither an LLM nor a shell executes the pasted text, and the original string is
not retained. GOSU accepts only a narrow subset and keeps imported loopback `-L` values inactive.

Use **Test** after the host key has been trusted once in Terminal and SSH agent or Keychain
authentication works without a password prompt. GOSU does not store passwords or private keys and
does not support interactive authentication.

For the active project, use **Remote workspace access** to select the server, enter one exact project
root such as `/workspace/research-project`, choose Diagnostics or Workspace mode, and acknowledge
the risk. The model cannot create this connection or grant itself; it sees only the opaque workspace
grant approved for the active project. You can then ask Project Chat to inspect Git or run a bounded
test/build. Each exact target, root, command, and argument list waits for a fresh **Allow once**
decision.

This slice has no interactive shell, TTY, file transfer, active tunnel, arbitrary remote patch,
background task, or unattended experiment execution. Workspace tests/builds execute repository code
with the SSH account's privileges, and the selected root is a lexical boundary rather than a remote
sandbox. Long GPU jobs belong on the isolated Runner path.

## Server status monitoring

Connections shows each registered server with a **Minimize / Show details** control. Project Chat
uses the same safe resource snapshot but starts with the detailed meters minimized so the transcript
keeps more space. A minimized card still shows availability, the last sample time, and bounded issues;
minimizing it does not disable monitoring.

**Settings → Servers** controls automatic refresh locally on this Mac. The supported choices are
Manual, 30 seconds, 1 minute (default), 5 minutes, and 10 minutes. Automatic monitoring runs only
while Connections or Project Chat is visible, pauses when the window is hidden, and waits for one
sample to finish before scheduling the next. Every server keeps its explicit **Refresh usage** action,
including in Manual mode. Resource snapshots remain memory-only and are not stored in SQLCipher,
Hosted Sync, chat history, or telemetry.

The macOS-only storage smoke test runs inside Electron so the native SQLCipher module, `safeStorage`,
close/reopen recovery, encrypted file header, and transaction rollback are exercised with their
actual runtime ABI:

```bash
pnpm --filter @gosu/desktop smoke:local-db:mac
```

It creates and removes an isolated temporary user-data directory. It is intentionally separate from
the cross-platform Vitest suite.

The Markdown viewer geometry smoke test opens real Chromium layout at GOSU's minimum supported window
size. It verifies that Research Notes and Repository Markdown previews own a usable vertical scroll
range while wide code remains horizontally scrollable inside its own block:

```bash
pnpm --filter @gosu/desktop smoke:markdown-viewer-scroll:mac
```

The Desktop accepts `GOSU_SYNC_API_URL` as a credential-free base URL. Plain HTTP is limited to
loopback; a remote endpoint must use HTTPS. Electron Main appends the fixed readiness path, rejects
redirects, bounds the request timeout, validates the GOSU health identity, and returns only a small
ready/degraded result over IPC.

`pnpm app:package` runs the complete repository gate and creates an ad-hoc-signed development DMG.
The local-only packaging command disables Hardened Runtime so Electron and its native modules share
a valid development signature without weakening the production signing configuration. The packaged
renderer keeps the strict production CSP; only the exact Vite development origin receives
the inline refresh and HMR exceptions required for local development. Developer ID signing,
notarization, update metadata, and clean-machine release validation remain release work. The
packaging hook also removes Electron's unused camera, microphone, audio, and Bluetooth usage
descriptions and replaces arbitrary transport access with the explicit loopback development
exception.

Because an ad-hoc signature has no stable Developer ID requirement, macOS can ask the user to allow
access to the existing `Electron Safe Storage` Keychain item after installing a rebuilt development
app. This prompt must be approved by the user; the packaging flow must not weaken or rewrite the
Keychain access policy to suppress it.

`pnpm app:package:release` keeps Hardened Runtime enabled and fails closed when a signing identity is
unavailable. It is the release entry point; Developer ID credentials and notarization configuration
must be supplied by the release environment.
