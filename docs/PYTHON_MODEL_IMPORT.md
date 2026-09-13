# Python function-entry model imports

Model Lab imports standalone Python solvers through static AST analysis; it does not import or run
the uploaded Python module. The callable-source pipeline is versioned as
`model-ir-canonical-v1-semantic-harness-v8-complete-callable-source-20260907`.

The previous analyzer could choose the last neural-network class and omit the external function
that actually drove inference. `mochi_model.py` demonstrates `forward_yuzu(model, kc, lam, ...)` in
its usage example, but the old analyzer chose only `MochiYuzuNet.forward` and retained 160 of 2,737
source lines. The generic analyzer now considers AST-parsed documentation examples and call
relationships, preserves function entrypoints and their transitive dependencies, and reports
unresolved alternatives. Filenames and model-specific class names are not routing rules.

The builder allocates its available context to source instead of reserving unused chat history.
The selected `mochi_model.py` closure fits in approximately 100,000 characters with no omitted
dependencies or imports. Incomplete source capsules fail before generation instead of silently
claiming a complete reconstruction. Conditional checkpoint branches remain conditional; weights
are not loaded to guess which branch or parameter configuration was used.

Large-source generation has a bounded ten-minute deadline, while small requests retain five
minutes. Fifteen-second progress heartbeats keep streamed requests active during silent provider
generation. Model generation accepts up to 2 MiB of CLI output; final ModelIR still has its own
1 MB validation limit. Generated candidates and audit failures are saved locally in private,
bounded import-run receipts. Raw uploaded sources, full prompts, credentials, and raw provider
stdout/stderr are not journal fields. Diagnostic write failures do not fail the model import.

When the full audit finds only formula/description operator mismatches, correction requests return
small patches for at most six exact modules instead of regenerating the whole graph. Only formula,
explanation, and activation annotations may change; transforms, ports, shapes, and connections
remain immutable. The merged candidate must pass the same full audit. Structural, source-contract,
provenance, ownership, and granularity failures cannot use this shortcut.

A retry may recover an untruncated candidate from the newest failed receipt with the exact same
source-and-pipeline digest. It recomputes the current audit before deciding whether a narrow repair
is eligible. Progress reports the recovery receipt and affected module count. No saved failure is
silently accepted as a valid graph, and successful imports still use the audited canonical cache.

Regression coverage includes wrapper-free novel API names, inheritance, dynamic loader choices,
ambiguous entrypoints, export ordering, reproducible source ordering, complete-source budgets,
pre-aborted requests, large JSON output, heartbeat disposal, durable failure receipts, exact-source
recovery, immutable narrow patches, and rejection of mixed structural/narrative failures.
The graph centering control is an icon-only SVG button with its existing accessible name, tooltip,
and canonical-layout reset callback.
