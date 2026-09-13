# GOSU shared typography

2026-09-13 post-0.58.31 source follow-up: global Briefing assistant body/input drop from 15px
to 13px; its toolbar title is 14px and welcome heading 18px (17px on narrow screens).
Chat Markdown headings use bounded 1.38/1.23/1.08/1em sizes rather than browser-default large
headings. Body line height is 1.7. Canvas, input height, icons, settings and conversation state are
unchanged. This does not rewrite Desktop text-size presets or mathematical source content.
Synthetic long-response inspection confirmed readable body/headings/math and fixed composer.
Focused tests: 12 passed; full Briefing 699; Desktop 2,394 passed / 8 existing environment skips;
Agent Runtime 667. Full check/build passed. Not included in installed or packaged 0.58.31 yet;
the running user conversation was not interrupted for replacement.

GOSU uses `packages/ui/src/typography.css` for Desktop and Model Lab UI text.
Previously Desktop mixed 8–12px compact captions with unscaled px/rem values, while the
embedded Model Lab did not receive the desktop text-size preference.

## Roles and presets

| Role                         | Compact | Default | Large | Extra large |
| ---------------------------- | ------: | ------: | ----: | ----------: |
| Body / chat / table contents |    10px |    12px |  14px |        16px |
| Controls / field labels      |    10px |    12px |  14px |        16px |
| Metadata                     |     9px |    11px |  13px |        15px |
| Captions / timestamps        |     9px |    11px |  13px |        15px |
| Section headings             |    12px |    14px |  16px |        18px |
| Page titles                  |    16px |    18px |  20px |        22px |

Roles remain distinct; consistency does not mean every element has the same size.
In 0.58.15 the title/body spread is reduced and captions move closer to body size, improving
balance without rewriting the saved preset. Desktop secondary text has stronger light/dark
contrast. Settings navigation uses content-sized rows rather than stretching to fill a tall pane;
page gutters and Settings card padding/gaps are reduced. Canvas/document math is unchanged.
The existing saved preset is preserved. The user-requested body sizes are Compact 10px,
Default 12px, Large 14px and Extra large 16px. Controls track the body size rather than
retaining the previous 13px minimum that would make Compact controls larger than body text.
Metadata and captions have a 9px floor. Both Settings descriptions and the Aa specimens
come from the shared preset constants, so labels and samples cannot drift independently.

All ordinary Desktop font-size declarations use semantic roles, except the four constant-driven
preset specimens and relative document/code typesetting ratios. Model Lab navigation,
controls, Copilot, status text, import details and inspector explanations use the same roles.

Canvas-owned module labels/formula ratios, graph zoom, PDF document content, and mathematical
subscript/superscript proportions are deliberately unchanged. The UI preference does not
rewrite a graph, pseudocode, equation, model file, or provider prompt.

## Embedded Model Lab

The desktop sends a bounded presentation-only message to each existing Model Lab frame:
`{ type: 'gosu:ui-typography', version: 1, textSize }`.

The frame accepts only one of the four preset values from its actual parent and the known
packaged-file/development origin. It accepts no arbitrary CSS, credentials, model operation,
or additional fields. Settings changes update the existing document's data attribute rather
than its URL, so pending model work and unsaved drafts are not discarded by a frame reload.
Standalone Model Lab uses the Default scale until embedded in GOSU.

## Verification

Briefing overview prose (0.58.29) retains bundled Pretendard Variable and the user's text-size preset.
Scoped narrative styles use weight 430, line height 1.78, restrained tracking, stronger weight 730
for emphasis, and compact batch separators. Code and math keep normal tracking. Exact source titles
and bounded literal content hints enrich cached prose at render time without changing stored text;
each overview uses only its own batch context. Keyword fragments contained in an exact title are
excluded so title emphasis remains intact. No external font is fetched. Synthetic production-component
rendering was inspected; installed-window visual verification was blocked by native-tool timeouts.

- Shared preset/message validation and role/readability-floor tests.
- Renderer regression proving font changes do not reopen/reload a Model Lab session.
- Child-frame source/origin/payload validation.
- `pnpm --filter @gosu/desktop smoke:typography:mac`: isolated real Chromium rendering at
  four sizes, English/Korean, light/dark Desktop surfaces and two window widths. It compares
  computed font sizes across Desktop and Model Lab, checks caption floors, table body size,
  input preservation and horizontal overflow. No account/provider calls or user data.
- Affected packages' full tests, typecheck, lint, format and production/package checks.

Test images are written to `tmp/screenshots/typography/`. The fixture uses production styles,
not the installed application's private data.
