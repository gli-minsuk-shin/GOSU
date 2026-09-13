# GOSU repository instructions

- User preference (2026-09-13, reaffirmed 2026-09-14): after completing and verifying requested GOSU changes, include
  installation into `/Applications/GOSU.app` in the handoff without requiring a separate update
  request. Follow the release runbook, preserve data and signing identity, and never interrupt an
  active user job or discard an unsent draft to force an update. Ask only when safe shutdown is blocked.

- Before maintenance or behavior changes, read `docs/MAINTENANCE_GUIDE.md` and the relevant topic
  from `docs/README.md`. These are the durable development memory; verify facts against current
  code and distinguish implemented features, prototypes, plans, and blocked live verification.
- Keep that memory current when changing architecture, provider boundaries, storage, or release
  procedures. For an app replacement follow `docs/RELEASE_RUNBOOK.md` and record actual version,
  backup, artifact hash, tests and installed-UI verification in `docs/releases/<version>.md`.
  Never copy credentials, private research content or user conversations into maintenance docs.

- Every behavior-changing application update must add or update a focused unit or regression test
  that would fail without the change. Run the focused test while developing, then run the affected
  package's full test suite, typecheck, lint, formatting check, and production build before handoff.
- Never report an application change as complete while its required tests are missing, skipped
  without an explicit environment reason, or failing. Include the exact test results in the handoff.
- Any GOSU Agent Runtime, Project Chat context, working-memory, run-graph, or delegation change must
  update the Agent Runtime regression coverage when behavior changes and pass
  `pnpm test:agent-runtime`. This named gate also runs in CI in addition to the full test suite.
- Mirror every created or updated Markdown file into the matching location under the GOSU Obsidian
  repository-docs mirror and verify that the source and mirror are byte-identical.
