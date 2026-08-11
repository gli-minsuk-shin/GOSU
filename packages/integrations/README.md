# GOSU integrations

Connectors declare their capabilities rather than pretending every external
tool supports two-way sync. The MVP guarantees:

- GitHub: canonical repository access with short-lived installation tokens.
- Zotero: metadata-only, read-only incremental access.
- Obsidian: local read-only parsing; the caller owns filesystem permission.
- Manuscript workspaces: a provider-neutral descriptor, checkpoint port, registry, and pure sync
  state derivation. A fake local checkpoint provider is exercised against the same port. Boolean
  provider facts do not become callable editor, compile, presence, comment, or realtime operations
  until separate versioned ports exist.
- Overleaf: the legacy immutable ZIP export remains a separate bootstrap helper. The registered
  `overleaf_git` adapter truthfully supports existing-project linking and manual inbound checkpoint
  capture only; it does not import source into a draft, create a review candidate, publish, merge,
  poll, or expose Overleaf realtime operations to GOSU.

Credential persistence is intentionally outside this package and belongs to the
desktop's app-private OS-backed secure store or the runner's local secret store.
