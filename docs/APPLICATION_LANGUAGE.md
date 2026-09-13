# Shared application language — GOSU 0.58.4

Settings → Appearance → Application language lets the user choose 한국어 or English. Model Lab
exposes the same preference in its sidebar language settings, including when used standalone.
Application UI copy, accessibility labels, help, errors, and date formatting use the selected
language. English technical terms, provider/model IDs, file paths, equations, source code, and
user-owned names/content are not rewritten. Existing conversations and generated model explanations
remain original; the preference applies to new AI prose rather than regenerating saved artifacts.
The native macOS application menu follows the same selection, including Settings, File, Edit, View,
Window and recognized submenu commands, while preserving native roles and keyboard shortcuts.
OS-owned Services entries and macOS permission dialogs remain controlled by macOS.

## One preference, separate responsibilities

Main owns `application-language.json` in the existing GOSU application-data directory, with strict
`en`/`ko` validation and atomic replacement. On macOS this is
`~/Library/Application Support/@gosu/desktop/application-language.json`. The renderer cache is only
a startup display hint; it does not control AI permissions or override the Main preference.
Missing legacy preferences retain the existing English UI and input-language-based AI behavior
until a user explicitly selects a language, including clicking English. Invalid saved preferences
surface an error rather than silently changing the AI's language.

The trusted Desktop preload exposes `applicationLanguage.get/set/onChanged`. Model Lab uses its
same-origin `/api/application-language` GET/PUT endpoint; hosted routes retain the existing project
capability boundary. Visible views refresh on focus and at a bounded interval. Desktop additionally
receives immediate Main notifications. Stale reads cannot override a newer confirmed selection.
A failed save does not switch the UI optimistically. No workspace is remounted to change language,
so drafts, graph state, and conversation scroll remain owned by their existing components.

Shared UI translation dictionaries live in `packages/ui`; translate only application-authored copy.
Named placeholders interpolate user values literally. Do not pass arbitrary model names, article
titles, custom board labels, source Markdown, or user messages through the UI translator.
Unknown source content remains unchanged. English is the fallback for new untranslated UI copy;
new interface strings must add both dictionary entries and focused language regression coverage.

## Native AI boundary

The shared contracts package supplies a trusted language-instruction section. Native Codex,
Claude Code, and Hermes adapters apply it to developer/system guidance, not as invented user text.
Model Lab's chat, import, normalization, narration, and Python-generation jobs share that policy.
Only human-readable prose fields change language: schemas, enums, code, formulas, citation targets,
filenames, and other machine-readable fields keep their original representation.

A run snapshots the preference when accepted. Queued runs persist the captured language, and
delegated callbacks retain the parent run's language. Changing Settings affects subsequent runs,
not a response already in flight. Model Lab's generation cache includes the configured language;
an English cached description is not reused as a Korean generation result. This adds no new tool
or project permissions and does not copy credentials or change providers.

## Verification

Regression coverage includes strict preference validation, failed/atomic saves, trusted IPC and
same-origin API checks, native developer boundaries across providers, queued/delegated run language,
and cache partitioning. UI tests cover Korean/English toggles, Main notifications, stale GET races,
save failures, placeholder integrity, original project names, drafts, code, and equations.

`pnpm --filter @gosu/desktop smoke:application-language:mac` runs an isolated Electron fixture using
the real Settings component, sidebar, and Markdown renderer. It tests both languages, both themes,
and sidebar widths 260/332px, preserves the same input node and typed content, and captures eight
screenshots under `tmp/screenshots/application-language`. It uses a disposable profile and fake
language API, never the user's actual preference or documents. Font assets are emitted as local
files in production so the existing `font-src 'self'` policy need not be weakened for KaTeX.

Full Desktop, Model Lab, contracts and UI suites, the Agent Runtime gate, typecheck, lint, formatting,
production builds and packaged startup smoke are required before handoff.
