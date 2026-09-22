# Architecture-first Model Lab graphs

2026-09-15 candidate [0.58.85](releases/0.58.85.md): graph-edit compilation feeds an actual bounded
validator report and the invalid candidate back for one repair instead of silently discarding all
diagnostics after a single attempt. Names and structural/formula issues are reported together.
The source seed is labelled saved, not already validated; native Copilot is told that editInstructions
is its supported compiler handoff even though inspection tools are read-only. No automatic apply
or runtime-proof claim is added. Both calls' available usage is retained, including failure paths.

Formula-chain detection counts only top-level relations, not equality qualifiers in braced axes,
indices, or function arguments. This fixes false rejection of e.g. min_{axis=1} and sum_{i=1}; real
collapsed assignment-chain tests still reject. A redundant ordinary edge between exactly matching
loop-carried ports in the same repeat owner is canonicalized to the already-present binding pair,
after endpoint/shape checks. Mismatched binding, owner, shape and ordinary external edges are not
silently repaired. The loop-carried ports/repeat contract remains in the saved model.

Installed status: [0.58.80](releases/0.58.80.md) includes the tensor reasoning contract below;
4,161 full tests / eight environment skips and 1,596 Runtime tests passed. Source-only/pending
descriptions below are development history. Actual user graphs were not regenerated during install.

## Tensor reasoning contract (2026-09-14, source after installed 0.58.79)

The builder, full pseudocode normalizer/chat edit and Copilot share MODEL_GRAPH_REASONING_POLICY.
It asks for a symbol/axis ledger, full carried state versus slices, matrix inner dimensions,
transpose/reduction/Softmax axes, reshape counts, residual operands and unchanged coordinates.
Source-declared design, algebraic consistency and observed execution are distinct. Conflicting
source operations must be explained as unresolved, never silently transposed or otherwise repaired.

New structured ModelIR generation requires module presentation fields: purpose, keyEquationIndex,
shapeNotes and uncertainties. The index selects a complete row of the existing formula; the parser
stores the resolved keyEquation, not separately rewritten math. It bounds every field, checks the
row and KaTeX safety, and rejects an explicitly unresolved formula with an empty warning list.
These checks ensure internal consistency, not mathematical proof of an arbitrary program or source
faithfulness. Original evidence, shape/operator audits and review-before-apply remain necessary.

Cards display role, one stored equation, shape notes, canonical IN/OUT and a specific warning.
The inspector retains all equations and full notes/uncertainties. Old models show their first stored
equation without inventing missing annotations or replacing corrupted dimensions. Human correction
of ambiguous transposes/double residuals still requires source evidence and explicit review.

The optional presentation JSON block survives Model Pseudocode v2 serialization and workspace
restart. Narrative-only formula repairs discard stale presentation only for affected modules;
other model content and annotations remain intact. Full regeneration rebuilds the annotations.
The builder pipeline cache namespace advances to v9; old saved models/caches are not deleted or
automatically regenerated. Do not claim this policy reconstructed the user's existing damaged model.

Synthetic native Astra/high explanation plus a five-module edit passed in about 95 seconds with
all five presentation records. An earlier duplicated-equation field failed validation; selecting
the canonical equation by index avoids that duplication. Hosted synthetic UI and restart checks
confirmed equations, tensor notes and uncertainty rows. Final gates/installation are recorded below.

2026-09-14 toolbar follow-up (source, not installed): graph modes and Focus graph now share a
primary row; backward-only scenario metadata and checkpoint controls use a compact secondary row.
Narrow-screen rules no longer force the checkpoint slider or each mode group to full width.
The toolbar keeps its intrinsic block height so wrapping cannot overlap the graph. This is a
presentation-only change: no saved model, formulas, gradient evidence or workspace settings change.
Synthetic hosted ModelLabApp visual QA covers 1280, 800 and 420px widths; the small-width overlap
found during QA was repaired before handoff. Model graph regression coverage protects grouping,
focus ordering, bounded control sizing and intrinsic toolbar height.
Validation: Model Lab 385 tests passed (31 files, no skips), typecheck, lint, formatting and
production build passed; documentation regression 2 passed. Installed app replacement remains
pending normal user quit. The previously signed 0.58.78 artifact predates this toolbar change;
it must be rebuilt and re-signed before this change can be installed.

2026-09-14, candidate 0.58.72. The initial graph is forward architecture, not gradient diagnostics.
Cards have a common bounded height, English display names, stage numbers, one purpose sentence,
compact input/output shapes, and a details affordance. Repeated blocks show the iteration count and
open to internal stages. Full formulas, ports, source evidence and explanations remain in details.
Backward mode still exposes gradient diagnostics. Overview uses dense ranks of actual stages so a
collapsed repeat does not leave gaps for its hidden stages. Stored topology and port IDs are unchanged.
Collapsed boundary edges use presentation-only summary ports so named endpoints actually render.
Parallel boundary tensors are retained instead of deduplicating by node pair. Long forward skip
connections on one lane route below cards rather than through intermediate blocks.

Old non-English names receive a presentation-only English alias from their stable identifier; this
does not rewrite saved models, revision hashes, references or conversations. New source-extraction
output requires English model/module/block names. Explanatory prose can use the application language.
The source builder requests meaningful short names and purpose-first explanations.

Symbolic dimensions accept bounded arithmetic such as `N_ctx+N_test` and `K*H`, without evaluating
code. Legacy parser syntax remains readable. Newly generated unsafe numeric axes are rejected;
old unsafe axes display `?` and a review warning, without inventing replacement dimensions.
Original model evidence remains available in details. Reconstructing an already-corrupt dimension
requires the original source, not an inferred correction from its graph.

Visual QA uses the actual graph component and a local capability-protected read-only preview of an
existing model. No private model is committed as a fixture, no model/LLM request is made, and no
workspace data is rewritten. Overview and repeated-block cards were inspected at 1280 × 720.
Synthetic regression tests cover naming, dimensions, equal card heights and details preservation.
Release gates and installed status are tracked in [0.58.72](releases/0.58.72.md).
