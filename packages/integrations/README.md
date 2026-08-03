# GOSU integrations

Connectors declare their capabilities rather than pretending every external
tool supports two-way sync. The MVP guarantees:

- GitHub: canonical repository access with short-lived installation tokens.
- Zotero: metadata-only, read-only incremental access.
- Obsidian: local read-only parsing; the caller owns filesystem permission.
- Overleaf: immutable, one-way export bound to a Git commit and archive hash.

Credential persistence is intentionally outside this package and belongs to the
desktop Keychain or the runner's local secret store.
