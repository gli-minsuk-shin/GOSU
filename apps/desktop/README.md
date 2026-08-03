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

The cache and offline outbox live in a ciphered SQLite database. Its random key
is sealed with Electron `safeStorage`, which uses the macOS Keychain. Obsidian
access is read-only, ignores symlinks, enforces the selected root, and rejects
files other than bounded Markdown documents. Navigation and privileged IPC are
accepted only from the exact packaged renderer URL or an explicit-port loopback
development origin and its main frame. Packaged builds ignore development URL
environment overrides.

## Runnable local slice

From the repository root, `pnpm app:dev` starts the loopback development Sync API, waits for the
versioned readiness endpoint, and then opens Electron. `pnpm app:doctor` checks prerequisites without
starting Codex or reading credentials. The renderer displays live, non-secret readiness for the app,
encrypted local data, Codex executable, and Sync API; research metrics and workflow cards remain
clearly labeled demo content.

The Desktop accepts `GOSU_SYNC_API_URL` as a credential-free base URL. Plain HTTP is limited to
loopback; a remote endpoint must use HTTPS. Electron Main appends the fixed readiness path, rejects
redirects, bounds the request timeout, validates the GOSU health identity, and returns only a small
ready/degraded result over IPC.

`pnpm app:package` runs the complete repository gate and creates an unsigned development DMG. The
packaged renderer keeps the strict production CSP; only the exact Vite development origin receives
the inline refresh and HMR exceptions required for local development. Signing, notarization, update
metadata, and clean-machine release validation remain release work. The packaging hook also removes
Electron's unused camera, microphone, audio, and Bluetooth usage descriptions and replaces arbitrary
transport access with the explicit loopback development exception.
