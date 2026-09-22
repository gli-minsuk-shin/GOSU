import { useState } from 'react';
import { alignedPreparedActions } from './email-action-weekday';
import { Temporal } from 'temporal-polyfill';
import type { defaultAssistantPreferences } from '@gosu/briefing-core';
import { initialEvent } from './calendar-dates';
import { CalendarEventEditor } from './calendar-event-editor';
import { sourceRequest } from './live-client';
import type { EventDraft } from './workspace-contracts';
import { BriefingTodoButton } from './briefing-todo-button';
import type { EmailPreparedActions } from './email-prepared-actions';

export function emailCalendarDraft(
  title: string,
  text: string,
  receivedAt?: string,
  timeZone = 'Asia/Seoul',
) {
  if (!/마감|기한|deadline|\bdue\b|회신|신청|제출|행사|세미나|회의|일정|설명회/i.test(text))
    return null;
  const match = /(?:(\d{4})\s*(?:년|[-/.])\s*)?(\d{1,2})\s*(?:월|[-/])\s*(\d{1,2})\s*일?/.exec(
    text,
  );
  if (!match) return null;
  try {
    const year = match[1]
      ? Number(match[1])
      : receivedAt
        ? Temporal.Instant.from(receivedAt).toZonedDateTimeISO(timeZone).year
        : null;
    if (!year) return null;
    const day = Temporal.PlainDate.from(
      { year, month: Number(match[2]), day: Number(match[3]) },
      { overflow: 'reject' },
    );
    const tail = text.slice(match.index + match[0].length).split('\n')[0]!;
    const nextDate = /\d{1,2}\s*(?:월|[-/])\s*\d{1,2}/.exec(tail);
    const segment = nextDate ? tail.slice(0, nextDate.index) : tail;
    const time = /(오전|오후)?\s*(\d{1,2})(?:시(?:\s*(\d{1,2})분)?|:(\d{2}))/.exec(segment);
    let start = day.toString();
    if (time) {
      let hour = Number(time[2]);
      if (time[1]) {
        if (hour < 1 || hour > 12) return null;
        hour = (hour % 12) + (time[1] === '오후' ? 12 : 0);
      }
      const suffix = /^(?:\s*)(AM|PM)\b/i.exec(segment.slice(time.index + time[0].length));
      if (suffix && !time[1]) {
        if (hour < 1 || hour > 12) return null;
        hour = (hour % 12) + (suffix[1]!.toUpperCase() === 'PM' ? 12 : 0);
      }
      const clock = Temporal.PlainTime.from(
        { hour, minute: Number(time[3] ?? time[4] ?? 0) },
        { overflow: 'reject' },
      );
      start = day.toPlainDateTime(clock).toString();
    }
    const notice = `요약에서 찾은 날짜입니다. 원문과 대조해 주세요.${!match[1] ? ' 연도는 메일 수신 연도를 사용했습니다.' : ''}${time ? ' 종료 시각은 임시로 1시간 뒤입니다.' : ' 시간이 명시되지 않아 종일 일정으로 제안합니다.'}`;
    return {
      draft: {
        ...initialEvent(timeZone, '', start, undefined, !time),
        title: title.slice(0, 300),
        notes: text.slice(0, 5500),
      },
      notice,
    };
  } catch {
    return null;
  }
}
export function EmailCalendarButton({
  routineId,
  title,
  text,
  receivedAt,
  sourceKey,
  preparedActions,
}: {
  routineId: string;
  title: string;
  text: string;
  receivedAt?: string | undefined;
  sourceKey?: string | undefined;
  timeZone?: string | undefined;
  preparedActions?: EmailPreparedActions | null | undefined;
}) {
  const [editor, setEditor] = useState<{ draft: EventDraft; ids: string[]; notice: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [created, setCreated] = useState(false);
  // A draft prepared by the summary is always offered; the keyword check only covers older summaries
  // (an English "See you on Saturday" dinner has none of these words).
  const calendarEligible =
    Boolean(preparedActions?.event) ||
    /마감|기한|deadline|\bdue\b|회신|신청|제출|행사|세미나|회의|일정|설명회|시험|방문|약속/i.test(
      `${title} ${text}`,
    );
  return (
    <div className="briefing-email-calendar-action" onClick={(event) => event.stopPropagation()}>
      {calendarEligible && (
        <button
          type="button"
          disabled={busy || created}
          onClick={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              const { preferences } = await sourceRequest<{
                preferences: ReturnType<typeof defaultAssistantPreferences>;
              }>('/assistant/settings/get', { routineId }, new AbortController().signal);
              if (!preferences.calendarRead || !preferences.calendarIds.length)
                throw new Error('GOSU 설정의 Briefing Lab에서 연결된 캘린더를 확인해주세요.');
              if (!preparedActions?.event)
                throw new Error(
                  '저장된 일정 초안이 없습니다. 날짜·시간이 명확한 이메일을 요약하면 함께 준비됩니다. 추가 AI 호출은 하지 않습니다.',
                );
              const aligned = alignedPreparedActions(
                preparedActions,
                preparedActions.event.timeZone,
              )!.event!;
              const { evidenceQuote, notice, ...eventDraft } = aligned;
              const prepared = {
                draft: { ...eventDraft, calendarId: '' },
                notice: `${notice}\n근거: ${evidenceQuote}\n이메일 요약 때 준비한 일정 · 추가 AI 호출 없음`,
              };
              setEditor({ ...prepared, ids: preferences.calendarIds });
            } catch (e) {
              setError(e instanceof Error ? e.message : '일정 준비 실패');
            } finally {
              setBusy(false);
            }
          }}
        >
          {created ? '일정 등록됨' : busy ? '준비 중…' : '＋ 일정 생성'}
        </button>
      )}
      <BriefingTodoButton
        routineId={routineId}
        title={title}
        text={text}
        sourceKey={sourceKey}
        receivedAt={receivedAt}
        preparedTask={preparedActions?.task}
      />
      {error && <small role="alert">{error}</small>}
      {editor && (
        <CalendarEventEditor
          routineId={routineId}
          initial={editor.draft}
          calendarIds={editor.ids}
          heading="일정으로 등록할까요?"
          notice={editor.notice}
          onClose={() => setEditor(null)}
          onSaved={() => setCreated(true)}
        />
      )}
    </div>
  );
}
