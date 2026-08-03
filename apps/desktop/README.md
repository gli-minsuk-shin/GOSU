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
accepted only from the exact packaged renderer URL or the configured development
origin and its main frame.
