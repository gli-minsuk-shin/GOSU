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
- opening active Research Notes directly at the folder tree and reader with the shared page heading
  removed and compact Project Chat-sized content insets; empty-project guidance keeps its heading;
- minimizing the Research Notes folder tree into a persistent 44px restore rail so the mounted
  Markdown reader reclaims the available space without losing the selected note or tree state;
- projecting Literature searches into `Literature Review.md` and creating non-overwritten paper notes;
- using project-scoped Codex chats with runtime-discovered models, reasoning, and native modes;
- independently minimizing the Project Chat sessions rail and model/server detail panel so the
  transcript reclaims the available width and height;
- inspecting an app-managed Git workspace and reviewing its branches, history, and changes;
- building and incrementally updating a project literature review table;
- registering a safely parsed SSH destination and granting a remote workspace root to one project;
- using Project Chat to list/read/create/hash-check bounded remote text-file replacements, then run
  approved Python, tests, or builds and analyze their bounded output;
- monitoring registered server CPU, memory, and GPU usage with collapsible status cards and a local
  refresh preference; and
- showing the number of durable changes waiting in the local outbox.

These records survive an app restart. The pending-change count does not claim cloud delivery: a
Sync delivery/reconciliation worker and multi-user authorization are not connected to this local
workspace yet. The Sync readiness indicator only reports whether the development API can be
reached. The remaining research modules are visibly marked as later work rather than populated with
simulated experiment or manuscript results.

## Compact Project Chat layout

Use the chevron beside **Sessions** to leave a narrow restore rail, and use **Minimize** in the chat
toolbar to replace the model, agent, and server detail area with one compact status row. The two
choices are independent and persist locally across restarts. The compact row keeps the effective
model, reasoning option, model-selection warning, and linked-server or SSH setup state visible;
conversation warnings and the composer remain available. These visual preferences are not written
to the project database, Git, Hosted Sync, or model context.

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
grant approved for the active project. Choose **Workspace** mode when Project Chat needs to work on
code. You can then ask it to inspect Git, list or read project files, create a new text file, replace
an existing text file using the SHA from its latest read, and run a bounded Python entrypoint,
test, or build. File access and execution are separate operations; each exact target, root, action,
path/content or command/argument list waits for a fresh **Allow once** decision.

Each request opens as a centered blocking alert dialog, and GOSU shows only one approval at a time.
The exact preview scrolls independently while the decision bar stays visible with sticky **Deny** and
**Allow once** actions plus a live countdown. Background workspace controls become inert while the
dialog is open, keyboard focus stays inside it, **Escape** means **Deny**, and **Deny** is the safe
initial focus. Closing the dialog restores the previously focused control without moving the chat
scroll position. The default decision window is five minutes. Creating
or replacing a file and executing the resulting Python, test, or build are always separate requests,
so approving file content never approves its execution and every operation needs a fresh
**Allow once** decision. If the Renderer misses an event or the chat remounts, it queries Main for
the pending request bound to that exact project and session and restores the same dialog. Main owns
the authoritative pending request in process memory; the Renderer keeps only a volatile presentation
queue, countdown, and resolved-request ID tombstones. Neither side persists or syncs this state, and
the tombstones prevent a stale query from resurrecting an already allowed, denied, expired, or cancelled
dialog. A late event for an already resolved request is ignored, and a request that does not match
the currently visible project and chat is denied instead of appearing in the wrong workspace.
Navigating to another project or session still cancels the prior scope rather than carrying its
approval forward.

The file broker supports bounded UTF-8 text only. It blocks symlinks, traversal, secret/key paths,
binary and large files, and does not expose delete, rename, chmod, parent-folder creation, or general
file transfer. Create is create-only. Replacement rechecks the expected SHA immediately before an
atomic rename, but this is not a compare-and-swap transaction: an unrelated server process can
change the path between the recheck and final rename. If the file changed but its receipt or SSH
transport then fails, the outcome is uncertain; re-read the same path and compare its SHA with the
proposed content before retrying or claiming that nothing changed. This slice also has no
interactive shell, TTY, active tunnel, raw shell command, background task, or unattended experiment
execution through the broker. Command approval binds the displayed argv and working directory, not
the hashes of repository source files that Python, tests, or builds may load; those files can change
before launch. Approved Python, tests, and builds are untrusted repository code with the SSH
account's privileges and can access or change anything that account can reach; the selected root is
not a sandbox for executed code. Root workspace execution remains a prototype-only **HIGH RISK**
exception behind an explicit project grant and a fresh **Allow once** decision. Hardened production
execution must use a non-root isolated Runner. Long GPU jobs also belong on that Runner path.

The Project Chat dynamic-tool budget for these approval-bearing SSH operations is 450 seconds:
300 seconds for the decision window, up to 120 seconds for command execution, and a 30-second
transport and settlement margin. The file helper itself remains bounded to 30 seconds.

## Server status monitoring

Connections shows each registered server with a **Minimize / Show details** control. Project Chat
uses the same safe resource snapshot but starts with the detailed meters minimized so the transcript
keeps more space. A minimized card keeps a compact summary directly beside **Server usage**: CPU,
Memory, and GPU utilization remain visible without reopening the meters. Multi-GPU servers show the
maximum reported utilization as **GPU max** together with the reporting-device count; unavailable,
not-detected, and stale samples stay explicit rather than being displayed as zero. Availability, the
last sample time, and bounded issues also remain visible, and minimizing does not disable monitoring.

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

The Markdown viewer geometry smoke test opens real Chromium layouts at compact and wide window
sizes. It verifies that Research Notes and Repository Markdown previews own a usable vertical scroll
range while wide code remains horizontally scrollable inside its own block. It also collapses and
restores the Research Notes folder tree with extra-large text and long paths, checking that the
reader reclaims space, the persistent toggle keeps keyboard focus, and the viewer stays contained:

```bash
pnpm --filter @gosu/desktop smoke:markdown-viewer-scroll:mac
```

The Project Chat geometry smoke test uses the production stylesheet in real Electron windows with
extra-large text, a maximum-width project sidebar, long chat history, and populated session/server
panels. It verifies that each minimize control reclaims space without moving the composer outside
the chat shell:

```bash
pnpm --filter @gosu/desktop smoke:project-chat-compact:mac
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
