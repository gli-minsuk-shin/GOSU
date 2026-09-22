# Sidebar project ordering

See [sidebar design](SIDEBAR_ICON_DESIGN.md) and [release 0.58.70](releases/0.58.70.md).

Active project name rows are draggable. The top/bottom half of another project's header chooses
before/after insertion, shown by a theme-colored line without reflow. Drag enter/over marks a valid
drop, including transitions from label text to row padding. Only a locally started project drag is
accepted; file/text drags, self drops, cancelled drags and unavailable rows never reorder.
Collapsing the group or removing the dragged source clears transient drag state. Project menu Move
up/down controls provide a keyboard-accessible alternative. Child section order is unchanged.

The optional `projectOrder` ID array lives in existing `gosu:project-navigation:v1` localStorage in
GOSU user data, alongside sidebar width/expanded/hidden state. Drops save immediately in the parent
and preserve existing navigation state; a failed write is announced. New projects append in their
existing order. Hidden/archived IDs retain their place until restored; deleted IDs are pruned from
the snapshot. IDs are deduplicated and bounded at the existing navigation-state 500-ID limit.

This is local sidebar presentation, not a project mutation, hierarchy change or Sync command. Project
contents, timestamps, selection, open sections and active work remain untouched. App replacement
must preserve the existing user-data Local Storage directory; it is not inside the app bundle.
Older apps ignore the optional order field; normal forward updates retain it. No user data is reset.
