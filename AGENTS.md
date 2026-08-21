# GOSU repository instructions

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
