import { useEffect, useState } from 'react';
import type { BriefingRoutine } from '@gosu/briefing-core';
import { BriefingChat } from './briefing-chat';
import type { PaperChatReference } from './paper-chat-reference';
import { briefingChatContextKey } from './briefing-model-selection';
import type { SettingsProposal } from './assistant-settings-proposal';

/** Keep opened panes alive within this page; hiding UI never resets a conversation or its request.
 * Provider/permission-context changes still replace the keyed pane and abort the old request.
 */
export function RetainedBriefingChats({
  globalMode = false,
  paperReference,
  routines,
  selectedId,
  visible,
  recommendationRequest,
  onBusyChange,
  onSettings,
}: {
  routines: readonly BriefingRoutine[];
  globalMode?: boolean;
  paperReference?: PaperChatReference | undefined;
  selectedId: string | undefined;
  visible: boolean;
  recommendationRequest: number;
  onBusyChange: (busy: boolean) => void;
  onSettings: (proposal?: SettingsProposal) => void;
}) {
  const [opened, setOpened] = useState<readonly string[]>([]);
  useEffect(() => {
    if (visible && selectedId)
      setOpened((ids) => (ids.includes(selectedId) ? ids : [...ids, selectedId]));
  }, [visible, selectedId]);
  return (
    <>
      {routines
        .filter((r) => opened.includes(r.id) || (visible && r.id === selectedId))
        .map((routine) => {
          const selected = routine.id === selectedId;
          const active = visible && selected;
          return (
            <div
              key={briefingChatContextKey(routine)}
              className="briefing-chat-session"
              hidden={!active}
            >
              <BriefingChat
                globalMode={globalMode && active}
                paperReference={
                  paperReference?.routineId === routine.id ? paperReference : undefined
                }
                routine={routine}
                visible={active}
                recommendationRequest={active ? recommendationRequest : 0}
                {...(selected ? { onBusyChange } : {})}
                onSettings={onSettings}
              />
            </div>
          );
        })}
    </>
  );
}
