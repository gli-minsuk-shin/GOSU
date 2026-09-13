import { uiText } from '@gosu/ui/language';

import {
  DEFAULT_WORKSPACE_BOARD_SETTINGS,
  type WorkspaceTaskStatus,
} from '../../shared/workspace-contracts';

/** Translate built-in workflow labels only; custom labels remain user-owned text. */
export function boardColumnDisplayLabel(status: WorkspaceTaskStatus, label: string) {
  return label === DEFAULT_WORKSPACE_BOARD_SETTINGS.columnLabels[status] ? uiText(label) : label;
}

export function boardTitleDisplayLabel(title: string) {
  return title === DEFAULT_WORKSPACE_BOARD_SETTINGS.title ? uiText(title) : title;
}
