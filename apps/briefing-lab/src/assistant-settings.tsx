import { useState } from 'react';
import {
  defaultAssistantPreferences,
  defaultLiveSettings,
  type BriefingRoutine,
  type LiveSettings,
} from '@gosu/briefing-core';
import { sourceRequest } from './live-client';
import type { CalendarInfo } from './workspace-contracts';
import { ReminderSettings } from './reminder-settings';
import { BriefingAgentModels } from './briefing-agent-models';

export function AssistantSettings({
  routine,
  onChange,
}: {
  routine: BriefingRoutine;
  onChange: (live: LiveSettings) => void;
}) {
  const live = routine.live ?? defaultLiveSettings(),
    prefs = live.assistant ?? defaultAssistantPreferences();
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [message, setMessage] = useState(''),
    [connecting, setConnecting] = useState(false);
  const patch = (value: Partial<typeof prefs>) =>
    onChange({ ...live, assistant: { ...prefs, ...value } });
  const connect = async () => {
    setConnecting(true);
    setMessage('Apple Calendar 연결 확인 중… macOS 접근 요청이 표시되면 직접 확인해주세요.');
    try {
      const v = await sourceRequest<{ calendars: CalendarInfo[] }>(
        '/calendar/authorize',
        { routineId: routine.id },
        new AbortController().signal,
      );
      setCalendars(v.calendars);
      setMessage(`Apple Calendar 연결됨 · ${v.calendars.length}개 중 사용할 캘린더를 선택하세요.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Calendar 연결 실패');
    } finally {
      setConnecting(false);
    }
  };
  return (
    <section
      className="briefing-settings-section briefing-assistant-settings"
      aria-label="AI 및 Calendar 설정"
    >
      <header>
        <span className="briefing-step">06</span>
        <div>
          <h2>AI 비서 · 자동 요약 · Calendar</h2>
          <p>
            아래 설정 저장으로 적용합니다. 기본값은 설정한 범위의 요청을 항상 허용하며, 필요하면
            매번 확인으로 바꿀 수 있습니다.
          </p>
        </div>
      </header>
      <BriefingAgentModels routineId={routine.id} />
      <div className="briefing-form-grid">
        <label className="briefing-field">
          <span>Briefing 요청 확인</span>
          <select
            value={prefs.confirmationPolicy}
            onChange={(e) =>
              patch({ confirmationPolicy: e.target.value as typeof prefs.confirmationPolicy })
            }
          >
            <option value="always">항상 허용 · 설정한 범위</option>
            <option value="ask">매번 확인</option>
          </select>
          <small>
            기본값은 항상 허용입니다. Mail·memory·AI 요약의 반복 확인을 줄이며, macOS 권한과
            Calendar 일정 쓰기 확인은 별도입니다.
          </small>
        </label>
        <label className="briefing-field">
          <span>Apple Mail 원본 열기 확인</span>
          <select
            value={prefs.mailOpenConfirmation ?? 'always'}
            onChange={(e) => patch({ mailOpenConfirmation: e.target.value as 'always' | 'ask' })}
          >
            <option value="always">항상 허용 · 원본 아이콘 클릭 시 (기본)</option>
            <option value="ask">매번 확인</option>
          </select>
          <small>
            아이콘을 직접 누르면 GOSU가 확인된 원본 메일만 Apple Mail에 전달합니다. 브라우저 외부 앱
            확인을 거치지 않으며, 자동 실행·메일 보내기·삭제는 허용하지 않습니다. Mail 앱 설정에
            따라 읽음 처리될 수 있고, macOS 권한·계정 로그인은 별도입니다.
          </small>
        </label>
      </div>
      <label className="briefing-setting-toggle">
        <input
          type="checkbox"
          checked={prefs.autoPaperSummary}
          onChange={(e) => patch({ autoPaperSummary: e.target.checked })}
        />
        <span>
          <b>논문 자동 AI 요약</b>
          <small>
            자료 조회 후 논문을 별도로 요약합니다. 한 번에 최대 6개씩 · 설정 → Agent의 ‘Briefing ·
            이메일·논문 요약’ 모델 사용.
          </small>
        </span>
      </label>
      <label className="briefing-setting-toggle">
        <input
          type="checkbox"
          checked={prefs.mailRead}
          onChange={(e) => patch({ mailRead: e.target.checked })}
        />
        <span>
          <b>설정한 Apple Mail 범위 읽기</b>
          <small>
            위에서 선택한 계정·메일함·기간·최대 개수만 읽습니다. 보내기·삭제·읽음 변경 없음.
          </small>
        </span>
      </label>
      <label className="briefing-setting-toggle">
        <input
          type="checkbox"
          checked={prefs.mailAi}
          onChange={(e) => patch({ mailAi: e.target.checked })}
        />
        <span>
          <b>허용한 메일·일정·할 일·프로젝트·비공개 memory를 LLM에 전달</b>
          <small>
            요약·중요도·검색·이력 답변에 사용합니다. 설정 → Agent에서 Briefing 작업에 지정한 모델의
            제공자에게 전달되며, 그 제공자의 서버 및 CLI 보관 정책이 적용됩니다. 끄면 새 비공개 AI
            처리를 차단합니다.
          </small>
        </span>
      </label>
      <label className="briefing-setting-toggle">
        <input
          type="checkbox"
          checked={prefs.mailBodyPreview}
          onChange={(e) => patch({ mailBodyPreview: e.target.checked })}
        />
        <span>
          <b>메일 본문 미리보기(최대 4,000자)로 요약 기준 생성</b>
          <small>
            메일 원문 일부를 읽고 요약·이력 표시를 더 정확하게 만듭니다. 원문 저장은 하지 않으며
            보내기·삭제·이동 동작은 수행하지 않습니다.
          </small>
        </span>
      </label>
      {prefs.mailAi && !prefs.mailRead && (
        <p role="status" className="briefing-alert">
          AI 전달은 허용되어 있지만 메일 읽기가 꺼져 있어 이메일 조회·다시 요약은 실행되지 않습니다.
          이메일도 요약하려면 위의 ‘설정한 Apple Mail 범위 읽기’를 켜고 설정을 저장해주세요. 일정·할
          일 등 다른 자료의 AI 허용은 그대로 유지됩니다.
        </p>
      )}
      <label className="briefing-setting-toggle">
        <input
          type="checkbox"
          checked={prefs.projectRead ?? false}
          onChange={(e) => patch({ projectRead: e.target.checked })}
        />
        <span>
          <b>전역 AI 비서의 프로젝트 대화·기억 접근</b>
          <small>
            GOSU의 활성 프로젝트 진행 상황과 최근 대화를 읽습니다. 위 비공개 AI 전달 허용도
            필요합니다. 프로젝트 간 대화는 자동 복제하지 않으며, 기억 공유·작업 전달은 대상과 내용을
            확인합니다.
          </small>
        </span>
      </label>
      <fieldset>
        <legend>Apple Calendar</legend>
        <button
          type="button"
          className="briefing-button"
          disabled={connecting}
          onClick={() => void connect()}
        >
          {connecting ? '연결 중…' : 'Apple Calendar 연결 / 목록 새로고침'}
        </button>
        <label className="briefing-setting-toggle">
          <input
            type="checkbox"
            checked={prefs.calendarRead}
            onChange={(e) => patch({ calendarRead: e.target.checked })}
          />
          <span>
            <b>선택한 캘린더 조회 · 오늘/내일 일정 브리핑</b>
            <small>일정 추가·수정·삭제는 매번 변경 내용을 확인한 후 실행합니다.</small>
          </span>
        </label>
        <label className="briefing-setting-toggle">
          <input
            type="checkbox"
            checked={prefs.todoRead ?? false}
            onChange={(e) => patch({ todoRead: e.target.checked })}
          />
          <span>
            <b>GOSU 할 일 조회 · 일정과 함께 브리핑</b>
            <small>
              완료하지 않은 할 일을 읽습니다. AI 질문에는 private AI 허용도 필요하며 할 일 수정·완료
              처리는 하지 않습니다.
            </small>
          </span>
        </label>
        {calendars.length ? (
          <div className="briefing-calendar-choices">
            {calendars.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={prefs.calendarIds.includes(c.id)}
                  onChange={(e) =>
                    patch({
                      calendarIds: e.target.checked
                        ? [...prefs.calendarIds, c.id]
                        : prefs.calendarIds.filter((id) => id !== c.id),
                    })
                  }
                />
                <span style={{ color: c.color }}>●</span> {c.name}{' '}
                <small>
                  {c.source}
                  {c.writable ? '' : ' · 읽기 전용'}
                </small>
              </label>
            ))}
          </div>
        ) : (
          <p className="briefing-muted">
            {prefs.calendarIds.length
              ? `${prefs.calendarIds.length}개 캘린더가 저장되어 있습니다. 목록을 불러와 변경할 수 있습니다.`
              : '목록을 불러와 사용할 캘린더를 고르세요.'}
          </p>
        )}
      </fieldset>
      {message && (
        <p role="status" className="briefing-muted">
          {message}
        </p>
      )}
      <ReminderSettings key={routine.id} routineId={routine.id} />
    </section>
  );
}
