# Critical Review

2026-09-14 source implementation. Critical Review replaces the disabled Review project entry.
It has two independent, durable chat modes, not a trained reviewer model or an acceptance predictor.

## Research basis and design

- [Liang et al., 2023](https://arxiv.org/abs/2310.01783) evaluated GPT-4 manuscript feedback
  against human reviews and with researchers. This motivates an author-side feedback aid, not a
  claim of human-equivalent correctness or guaranteed benefit for current models.
- [Self-Refine](https://selfrefine.info/) describes actionable feedback followed by revision.
  We adopt localized repairs and follow-up comparison. We do not implement its autonomous iterative
  loop: the author supplies revisions; one normal model turn performs the requested critique.
- [Zhou et al., LREC-COLING 2024](https://aclanthology.org/2024.lrec-main.816/) reports limitations
  in automatic paper reviewing. We require uncertainty, coverage limitations and source checking,
  and avoid acceptance probabilities, fabricated scores or treating missing input as proven error.
- [NeurIPS reviewer guidelines](https://neurips.cc/Conferences/2026/ReviewerGuidelines) inform
  generic quality, clarity, significance and originality dimensions. The app does not claim a
  permanently current venue rubric; users can supply their target's actual criteria.

These are design choices informed by the sources, not a measured critic-quality improvement.

## Two modes

**Research direction:** scientific question, contribution, claim/assumption/evidence chain,
confounding, falsifiability, resource feasibility and the smallest decisive experiment or proof.
It can read permitted project goals, experiment summaries, plans and Research Notes.

**Manuscript review:** artifact-grounded soundness, contribution, clarity, reproducibility,
limitations and likely reviewer objections/rebuttal evidence. It excludes automatic project task,
objective and permanent-memory context and removes project/Notes/experiment read tools. Only this
review's history, attached artifacts and captured manuscript checkpoint reads remain available
through GOSU tools. Provider web search still follows the project's existing preference. Figures
are not claimed inspected unless actual visual inputs were available; incomplete reads must be
labeled excerpt/provisional reviews. Manuscript checkpoints are immutable local captures, not
live or unsaved Overleaf edits.

Each report is instructed to inventory coverage, summarize claims, retain strengths, prioritize
concerns with locators/severity/confidence/repair, ask author questions and identify three actions.
The source-check and strongest-author-response check happen within the selected model's turn;
they are not independent agents or validated proof checking. Revisions are compared within the
same mode's chat. New reviews remain separate; opening a tab never starts an LLM call.

## Storage and execution boundaries

`project_chat_sessions.critical_review_mode` is nullable and immutable. Existing sessions remain
unchanged; new sessions persist their mode, branches inherit it, renaming cannot switch it.
The Main service forces advice-only execution from the stored mode even when a renderer supplies
normal collaboration controls. Tool catalogs and dispatch both restrict critical reviews to reads;
no remote commands, experiment creation, plan updates, Literature writes or delegation are allowed.
Final structured actions and automatic note creation use the existing reviewer deny paths.
Reports are stored as ordinary encrypted chat history, with existing context/usage, attachments,
model selection, cancellation and queue support. Raw source attachments keep their existing
turn-scoped lifetime; a later revision may require reattachment or a captured checkpoint.

The high-performance Project Chat model routing is reused; explicit per-session selections win.
No dedicated fine-tuning, independent reviewer panel, automatic manuscript edit, external submission,
new account permission or real GPU experiment is introduced.

## Verification

Focused contracts, mode prompts, active sidebar, history filtering, service mode override and
forced forbidden callbacks are regression-tested. Native SQLCipher smoke checks mode restoration
with the existing durable context history. Full results and install status are in
[0.58.48](releases/0.58.48.md).
