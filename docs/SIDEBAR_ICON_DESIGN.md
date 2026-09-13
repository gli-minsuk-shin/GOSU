# Sidebar icon design — GOSU 0.58.3

2026-09-14 [0.58.46 candidate](releases/0.58.46.md): the AI assistant shortcut adds a small solid
four-point sparkle at the upper right of a closed, three-dot speech bubble. The bubble is inset within
the same 24-unit viewBox so the sparkle does not obscure the outline or clip at 18px. No pulsing,
animation, new font/image dependency, button resizing or navigation/chat state changes. The existing
theme/selected color, 22px slot and accessible button label are retained. This supersedes the
three-dot-only geometry below, not the chat canvas or settings icon.

Installed [0.58.33](releases/0.58.33.md) includes the composer slider correction below;
the actual installed assistant screenshot confirmed it. Earlier pending wording is historical.

Post-0.58.32 source: the Briefing/global assistant composer's permission-settings shortcut now
uses the same three-slider path and circles as GOSU's Settings sidebar icon. The existing 24-unit
grid, 1.7 stroke, button size, accessible label and settings callback remain unchanged. The
composer regression asserts the SVG geometry and retained click/draft behavior. Not installed yet.

2026-09-13 follow-up: the global assistant shortcut now uses a complete rounded speech bubble
with three centered dots instead of the open bubble/spark composition. Its existing slot, color,
label and navigation handler are unchanged. The earlier chat-canvas changes are retained, not
rolled back. This icon-only correction is included in installed [0.58.31](releases/0.58.31.md),
whose native screenshot confirmed the new icon at its existing size.

Project rows use a disclosure chevron and the project name, without a decorative folder glyph.
This gives long names more room and distinguishes project hierarchy from section navigation.
Selection, running indicators, project actions, and expand/collapse behavior remain unchanged.

All project and global section icons use the local `SidebarIcon` SVG component. The set uses a
24-unit drawing grid, an 18px optical box inside a 22px slot, 1.7-unit rounded strokes, and
theme-aware muted color. Selected icons use the existing green accent. No raster downloads,
emoji fonts, external image URLs, or new icon package are required.

Project chat uses a speech bubble; Model Lab uses stacked layers; Repository uses a branch;
Manuscript uses a document; Board uses columns; Goal & Metrics uses a target; Experiments uses a
flask; Literature uses an open book; Research Notes uses a notebook. Tasks, Search, Lecture,
Connections, Usage, Settings, and disabled Review share the same drawing style.

Icons are decorative (`aria-hidden`, `focusable=false`). Existing text labels provide the accessible
names. Do not add icon-only replacements for project names or shrink the clickable navigation rows.

## Verification

Focused sidebar regression tests require SVG coverage for every navigation item, retained labels
and current/disabled semantics, no folder glyphs, and a shared optical size. The production-renderer
visual smoke checks alignment and navigation in light/dark themes at 260px and 332px sidebar widths,
and saves screenshots for inspection. Run the Desktop full test suite, typecheck, lint, format,
production build, and packaged startup smoke before installing an update.
