import {
  useId,
  useMemo,
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  nextOccurrences,
  defaultLiveSettings,
  defaultAssistantPreferences,
  isPublicHttpsUrl,
  validateRoutine,
  type BriefingRoutine,
  type BriefingSchedule,
  type BriefingWorkspace,
  type SourceKind,
} from '@gosu/briefing-core';
import { withoutSampleContent } from './workspace-defaults';
import { RoutineCopilot } from './routine-copilot';
import { SectionOrderEditor } from './briefing-sections';
import { LiveSourceSettings } from './live-source-settings';
import { LiveBriefingView } from './live-briefing-view';
import { AssistantSettings } from './assistant-settings';
import { BriefingQuestionSettings } from './briefing-questions';
import { sourceRequest } from './live-client';
import { RetainedBriefingChats } from './retained-briefing-chats';
import {
  BriefingNotificationTargetSchema,
  type BriefingNotificationTarget,
} from './briefing-notifications';
import {
  PAPER_CHAT_REFERENCE,
  PaperChatReferenceSchema,
  type PaperChatReference,
} from './paper-chat-reference';
import { BriefingModelMenu } from './briefing-model-menu';
import { modelSelection } from './briefing-model-selection';
import { CalendarView } from './calendar-view';
import { BriefingHistoryView } from './briefing-history-view';
import { BRIEFING_HISTORY_CHANGED, type HistoryRemovalReceipt } from './briefing-history-removal';
import { SavedPaperSummaries } from './saved-paper-summaries';
import { BriefingCollapseAll } from './briefing-collapse-all';
import { BriefingGenerationControls } from './briefing-generation-controls';
import { isDesktopNavigation, isGosuEmbedded } from './desktop-bridge';
import { parseBriefingItemTarget } from './briefing-item-navigation';
import {
  settingsProposalDraft,
  settingsProposalText,
  type SettingsProposal,
} from './assistant-settings-proposal';
import { RoutineManager } from './routine-manager';
import type { LiveSourceResult } from './live-types';
import './styles.css';
import './workspace.css';
import './global-assistant-chat.css';

const KIND_LABELS = { personal: '개인 · 연구', funding: '연구과제' } as const;
const STATE_LABELS = {
  draft: '초안',
  enabled: '활성 미리보기',
  paused: '일시정지 미리보기',
} as const;
const SOURCE_LABELS: Record<SourceKind, string> = {
  email: '이메일',
  calendar: '일정',
  todo: '마감일 있는 할 일',
  papers: '최신 논문',
  weather: '날씨',
  'ai-news': 'AI 소식',
  news: '뉴스',
  conference: '학회 마감',
  funding: '연구과제',
};
const COUNTRIES = [
  ['KR', '한국'],
  ['US', '미국'],
  ['EU', 'EU'],
  ['JP', '일본'],
  ['GB', '영국'],
  ['CA', '캐나다'],
  ['AU', '호주'],
  ['GLOBAL', '국제'],
] as const;
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function formatDate(value: string, timeZone = 'Asia/Seoul', includeDate = true) {
  try {
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${value}T00:00:00.000Z`));
    }
    return new Intl.DateTimeFormat('ko-KR', {
      ...(includeDate ? ({ month: 'short', day: 'numeric', weekday: 'short' } as const) : {}),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function Icon({
  name,
}: {
  name: 'chevron' | 'calendar' | 'spark' | 'inbox' | 'plus' | 'close' | 'settings' | 'papers';
}) {
  const paths = {
    chevron: 'm8 5 6 7-6 7',
    calendar: 'M5 4h14v16H5zM8 2v5M16 2v5M5 9h14M8 13h3M14 13h2M8 17h3',
    papers: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
    inbox: 'M4 5h16v14H4zM4 13h5l1 3h4l1-3h5',
    plus: 'M12 5v14M5 12h14',
    close: 'm6 6 12 12M18 6 6 18',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="briefing-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Splitter({
  label,
  value,
  onChange,
  side,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  side: 'left' | 'right';
}) {
  const min = side === 'left' ? 220 : 250;
  const max = side === 'left' ? 380 : 460;
  const change = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const initial = value;
    const move = (next: globalThis.PointerEvent) =>
      change(initial + (next.clientX - startX) * (side === 'left' ? 1 : -1));
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
    window.addEventListener('pointercancel', end, { once: true });
  };
  return (
    <div
      className={`briefing-splitter ${side}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={begin}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          change(value + (event.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1));
        }
        if (event.key === 'Home') {
          event.preventDefault();
          change(min);
        }
        if (event.key === 'End') {
          event.preventDefault();
          change(max);
        }
      }}
    />
  );
}

function Preview({ schedule }: { schedule: BriefingSchedule }) {
  let dates: ReturnType<typeof nextOccurrences> = [];
  try {
    dates = nextOccurrences(schedule, now(), 5);
  } catch {
    /* Draft validity is reported by the settings form. */
  }
  return (
    <div className="briefing-preview">
      <div className="briefing-section-caption">다음 5회 · 계산 미리보기</div>
      {dates.length ? (
        <ol>
          {dates.map((date) => (
            <li key={date.scheduledFor}>
              <span>{formatDate(date.scheduledFor, schedule.timeZone)}</span>
              {date.adjustment !== 'none' && (
                <small>{date.adjustment === 'month-end' ? '말일 조정' : 'DST 조정'}</small>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="briefing-muted">유효한 날짜·시간대를 입력하면 표시됩니다.</p>
      )}
      <p className="briefing-muted">
        {schedule.timeZone} · 실제 예약 실행은 아직 연결되지 않았습니다.
      </p>
    </div>
  );
}

function RoutineSettings({
  routine,
  proposal,
  onSave,
  onDelete,
}: {
  routine: BriefingRoutine;
  proposal?: SettingsProposal;
  onSave: (routine: BriefingRoutine) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(() =>
    proposal ? settingsProposalDraft(routine, proposal) : routine,
  );
  const savedModel = modelSelection(routine.live?.assistant);
  useEffect(() => {
    setDraft((current) => {
      if (JSON.stringify(modelSelection(current.live?.assistant)) === JSON.stringify(savedModel))
        return current;
      const live = current.live ?? defaultLiveSettings();
      return {
        ...current,
        live: {
          ...live,
          assistant: { ...(live.assistant ?? defaultAssistantPreferences()), ...savedModel },
        },
      };
    });
  }, [JSON.stringify(savedModel)]);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [siteName, setSiteName] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [siteCountry, setSiteCountry] = useState('');
  const [siteError, setSiteError] = useState('');
  const fieldId = useId();
  const edit = (next: BriefingRoutine) => {
    setDraft(next);
    setSaved(false);
  };
  const schedule = (patch: Partial<BriefingSchedule>) =>
    edit({ ...draft, schedule: { ...draft.schedule, ...patch } });
  const save = async () => {
    if (saving) return;
    const normalized = {
      ...draft,
      interest: {
        keywords: draft.interest.keywords.map((keyword) => ({
          ...keyword,
          synonyms: keyword.synonyms.filter(Boolean),
        })),
        excluded: draft.interest.excluded.filter(Boolean),
      },
    };
    const live = normalized.live ?? defaultLiveSettings();
    const synchronizedLive = live.mail
      ? {
          ...live,
          mail: {
            ...live.mail,
            bodyPreview: live.assistant?.mailBodyPreview ?? live.mail.bodyPreview,
          },
        }
      : live;
    const problems = validateRoutine(normalized);
    setErrors(problems);
    if (!problems.length) {
      setSaving(true);
      try {
        await sourceRequest(
          '/assistant/settings/save',
          {
            routineId: normalized.id,
            name: normalized.name,
            timeZone: normalized.schedule.timeZone,
            live: synchronizedLive,
            interest: normalized.interest,
          },
          new AbortController().signal,
        );
        onSave({ ...normalized, live: synchronizedLive, updatedAt: now() });
        setSaved(true);
      } catch (e) {
        setErrors([e instanceof Error ? e.message : '설정 저장 실패']);
      } finally {
        setSaving(false);
      }
    }
  };
  const addSite = () => {
    try {
      const url = new URL(siteUrl.trim());
      if (!isPublicHttpsUrl(url.href) || !siteName.trim() || !siteCountry)
        throw new Error('invalid');
      if (draft.sources.some((source) => source.url === url.href)) {
        setSiteError('이미 추가한 URL입니다.');
        return;
      }
      edit({
        ...draft,
        sources: [
          ...draft.sources,
          {
            id: id(),
            kind: 'funding',
            label: siteName.trim(),
            url: url.href,
            country: siteCountry,
            origin: 'user',
          },
        ],
      });
      setSiteName('');
      setSiteUrl('');
      setSiteError('');
    } catch {
      setSiteError('사이트 이름, 국가, 유효한 HTTPS 주소를 입력하세요.');
    }
  };
  return (
    <div className="briefing-settings">
      {proposal && (
        <p role="status">
          AI 설정 변경안 · {settingsProposalText(proposal)} · 아래 내용을 확인한 뒤 설정 저장을 눌러
          적용하세요.
        </p>
      )}
      <section className="briefing-settings-section">
        <header>
          <span className="briefing-step">01</span>
          <div>
            <h2>루틴과 시간표</h2>
            <p>
              개인 연구 브리핑의 자동 실행 간격은 해당 세션 상단에서 1·2·4시간 등으로 선택합니다.
              아래 시간표는 계산 미리보기입니다.
            </p>
          </div>
        </header>
        <div className="briefing-form-grid">
          <Field label="루틴 이름">
            <input
              value={draft.name}
              onChange={(event) => edit({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field
            label="브리핑 종류"
            hint="종류를 바꾸면 맞지 않는 구독 항목은 초안에서 제외됩니다."
          >
            <select
              value={draft.kind}
              onChange={(event) => {
                const kind = event.target.value as BriefingRoutine['kind'];
                edit({
                  ...draft,
                  kind,
                  sources: draft.sources.filter((source) =>
                    kind === 'funding' ? source.kind === 'funding' : source.kind !== 'funding',
                  ),
                });
              }}
            >
              <option value="personal">개인 · 연구 브리핑</option>
              <option value="funding">연구과제 공고 브리핑</option>
            </select>
          </Field>
          <Field label="상태 · 미리보기 전용">
            <select
              value={draft.state}
              onChange={(event) =>
                edit({ ...draft, state: event.target.value as BriefingRoutine['state'] })
              }
            >
              <option value="draft">초안</option>
              <option value="enabled">활성 미리보기 (실행 안 함)</option>
              <option value="paused">일시정지 미리보기</option>
            </select>
          </Field>
          <Field label="반복 주기 · 미리보기 전용">
            <select
              value={draft.schedule.frequency}
              onChange={(event) =>
                schedule({ frequency: event.target.value as BriefingSchedule['frequency'] })
              }
            >
              <option value="daily">일 단위</option>
              <option value="weekly">주 단위 · 특정 요일</option>
              <option value="monthly">월 단위</option>
            </select>
          </Field>
          <Field
            label="반복 간격"
            hint={
              draft.schedule.frequency === 'daily'
                ? '2 = 2일마다'
                : draft.schedule.frequency === 'weekly'
                  ? '2 = 2주마다'
                  : '2 = 2개월마다'
            }
          >
            <input
              type="number"
              min={1}
              max={99}
              value={draft.schedule.interval}
              onChange={(event) => schedule({ interval: Number(event.target.value) })}
            />
          </Field>
          <Field label="전달 시각" hint="24시간 형식. 여러 시각은 쉼표로 구분: 08:00, 18:00">
            <input
              value={draft.schedule.times.join(', ')}
              placeholder="08:00, 18:00"
              onChange={(event) =>
                schedule({ times: event.target.value.split(',').map((value) => value.trim()) })
              }
            />
          </Field>
          <Field label="시작일">
            <input
              type="date"
              value={draft.schedule.anchorDate}
              onChange={(event) => schedule({ anchorDate: event.target.value })}
            />
          </Field>
          <Field label="시간대 (IANA)">
            <input
              value={draft.schedule.timeZone}
              placeholder="Asia/Seoul"
              onChange={(event) => schedule({ timeZone: event.target.value })}
            />
          </Field>
          {draft.schedule.frequency === 'monthly' && (
            <Field label="매월 날짜" hint="해당 날짜가 없는 달에는 말일로 조정합니다.">
              <input
                type="number"
                min={1}
                max={31}
                value={draft.schedule.monthDay}
                onChange={(event) => schedule({ monthDay: Number(event.target.value) })}
              />
            </Field>
          )}
        </div>
        {draft.schedule.frequency === 'weekly' && (
          <fieldset className="briefing-weekdays">
            <legend>전달 요일</legend>
            {DAYS.map((day, index) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={draft.schedule.weekdays.includes(index)}
                  onChange={() =>
                    schedule({
                      weekdays: draft.schedule.weekdays.includes(index)
                        ? draft.schedule.weekdays.filter((value) => value !== index)
                        : [...draft.schedule.weekdays, index].sort(),
                    })
                  }
                />
                {day}
              </label>
            ))}
          </fieldset>
        )}
        <Preview schedule={draft.schedule} />
      </section>
      <section className="briefing-settings-section">
        <header>
          <span className="briefing-step">02</span>
          <div>
            <h2>나의 연구 주제</h2>
            <p>제목·초록의 키워드 관련성이 우선입니다. 인용 수로 대신 순위를 매기지 않습니다.</p>
          </div>
        </header>
        <div className="briefing-keyword-labels" aria-hidden="true">
          <span>키워드</span>
          <span>중요도</span>
          <span>동의어 · 쉼표 구분</span>
          <span />
        </div>
        {draft.interest.keywords.map((keyword, index) => (
          <div className="briefing-keyword-row" key={index}>
            <input
              aria-label={`키워드 ${index + 1}`}
              value={keyword.term}
              placeholder="예: neural optimization"
              onChange={(event) =>
                edit({
                  ...draft,
                  interest: {
                    ...draft.interest,
                    keywords: draft.interest.keywords.map((item, number) =>
                      number === index ? { ...item, term: event.target.value } : item,
                    ),
                  },
                })
              }
            />
            <select
              aria-label={`키워드 ${index + 1} 중요도`}
              value={keyword.weight}
              onChange={(event) =>
                edit({
                  ...draft,
                  interest: {
                    ...draft.interest,
                    keywords: draft.interest.keywords.map((item, number) =>
                      number === index ? { ...item, weight: Number(event.target.value) } : item,
                    ),
                  },
                })
              }
            >
              {[1, 2, 3, 4, 5].map((weight) => (
                <option key={weight} value={weight}>
                  {weight}
                </option>
              ))}
            </select>
            <input
              aria-label={`키워드 ${index + 1} 동의어`}
              value={keyword.synonyms.join(', ')}
              placeholder="국문·영문 동의어"
              onChange={(event) =>
                edit({
                  ...draft,
                  interest: {
                    ...draft.interest,
                    keywords: draft.interest.keywords.map((item, number) =>
                      number === index
                        ? {
                            ...item,
                            synonyms: event.target.value.split(',').map((value) => value.trim()),
                          }
                        : item,
                    ),
                  },
                })
              }
            />
            <button
              type="button"
              className="briefing-icon-button"
              aria-label={`키워드 ${index + 1} 삭제`}
              onClick={() =>
                edit({
                  ...draft,
                  interest: {
                    ...draft.interest,
                    keywords: draft.interest.keywords.filter((_, number) => number !== index),
                  },
                })
              }
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="briefing-text-button"
          onClick={() =>
            edit({
              ...draft,
              interest: {
                ...draft.interest,
                keywords: [...draft.interest.keywords, { term: '', weight: 3, synonyms: [] }],
              },
            })
          }
        >
          + 키워드 추가
        </button>
        <Field
          label="제외 키워드"
          hint="쉼표로 구분합니다. 저장한 조건은 다음 브리핑부터 적용하며 과거 브리핑은 바꾸지 않습니다."
        >
          <input
            value={draft.interest.excluded.join(', ')}
            onChange={(event) =>
              edit({
                ...draft,
                interest: {
                  ...draft.interest,
                  excluded: event.target.value.split(',').map((value) => value.trim()),
                },
              })
            }
          />
        </Field>
      </section>
      {(draft.kind === 'funding' || draft.sources.length > 0) && (
        <section className="briefing-settings-section">
          <header>
            <span className="briefing-step">03</span>
            <div>
              <h2>{draft.kind === 'funding' ? '연구과제 소스와 국가' : '브리핑에 넣을 항목'}</h2>
              <p>항목 삭제는 이후 브리핑의 구독 설정만 바꿉니다. 이미 만든 카드는 유지합니다.</p>
            </div>
          </header>
          {draft.kind === 'funding' && (
            <>
              <fieldset className="briefing-country-picks">
                <legend>관심 국가 · 수동 선택</legend>
                {COUNTRIES.map(([code, name]) => (
                  <label key={code}>
                    <input
                      type="checkbox"
                      checked={draft.countries.includes(code)}
                      onChange={() =>
                        edit({
                          ...draft,
                          countries: draft.countries.includes(code)
                            ? draft.countries.filter((country) => country !== code)
                            : [...draft.countries, code],
                        })
                      }
                    />
                    {name}
                  </label>
                ))}
              </fieldset>
              <p className="briefing-muted">
                위치는 사용하지 않습니다. 국가는 소스 필터이며 신청 자격을 뜻하지 않습니다. 등록한
                사이트는 주소만 보관하며 자동 수집은 아직 지원하지 않습니다.
              </p>
            </>
          )}
          {draft.kind === 'funding' && (
            <details className="briefing-add-site">
              <summary>+ 연구과제 사이트 직접 추가</summary>
              <div className="briefing-form-grid">
                <Field label="사이트 이름">
                  <input value={siteName} onChange={(event) => setSiteName(event.target.value)} />
                </Field>
                <Field label="사이트 국가">
                  <select
                    value={siteCountry}
                    onChange={(event) => setSiteCountry(event.target.value)}
                  >
                    <option value="">국가 선택</option>
                    {COUNTRIES.map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="공고 페이지 HTTPS 주소">
                  <input
                    type="url"
                    value={siteUrl}
                    placeholder="https://…"
                    onChange={(event) => setSiteUrl(event.target.value)}
                  />
                </Field>
              </div>
              <p className="briefing-muted">
                주소만 저장합니다. 공식 여부 확인·로그인·웹 수집은 아직 지원하지 않습니다.
              </p>
              {siteError && (
                <p role="alert" className="briefing-error">
                  {siteError}
                </p>
              )}
              <button type="button" className="briefing-button" onClick={addSite}>
                사이트를 초안에 추가
              </button>
            </details>
          )}
          <div className="briefing-selected-sources">
            <h3>
              선택한 항목 <span>{draft.sources.length}</span>
            </h3>
            {draft.sources.length === 0 && (
              <p className="briefing-muted">등록한 사이트가 없습니다.</p>
            )}
            {draft.sources.map((source) => (
              <div className="briefing-selected-source" key={source.id}>
                <span>
                  <strong>{source.label}</strong>
                  <small>
                    사용자 등록 · 자동 수집 미지원
                    {source.url ? ` · ${source.url}` : ''}
                  </small>
                </span>
                <div>
                  <button
                    type="button"
                    className="briefing-icon-button"
                    aria-label={`${source.label} 항목 삭제`}
                    onClick={() =>
                      edit({
                        ...draft,
                        sources: draft.sources.filter((item) => item.id !== source.id),
                      })
                    }
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <SectionOrderEditor
        routine={draft}
        labels={SOURCE_LABELS}
        onChange={(sectionOrder) => edit({ ...draft, sectionOrder })}
      />
      <LiveSourceSettings routine={draft} onChange={(live) => edit({ ...draft, live })} />
      <AssistantSettings routine={draft} onChange={(live) => edit({ ...draft, live })} />
      <BriefingQuestionSettings
        value={draft.suggestedQuestions}
        onChange={(suggestedQuestions) => edit({ ...draft, suggestedQuestions })}
      />
      {errors.length > 0 && (
        <div role="alert" className="briefing-error">
          <strong>설정을 저장하지 못했습니다.</strong>
          <ul>
            {errors.map((error, index) => (
              <li key={`${fieldId}-${index}`}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <footer className="briefing-settings-footer">
        <button type="button" className="briefing-text-button danger" onClick={onDelete}>
          루틴 삭제
        </button>
        <div>
          {saved && <span role="status">초안을 저장했습니다.</span>}
          <button
            type="button"
            className="briefing-primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? '설정 저장 / 승인 확인 중…' : '설정 저장'}
          </button>
        </div>
      </footer>
    </div>
  );
}

export function BriefingApp({
  workspace: suppliedWorkspace,
  onChange,
  storageError,
}: {
  workspace: BriefingWorkspace;
  onChange: (workspace: BriefingWorkspace) => void;
  /** Legacy embedding callbacks are ignored; production offers only real collection. */
  onRun?: (routineId: string) => void;
  onReset?: () => void;
  storageError?: string | null | undefined;
}) {
  const [globalAssistant, setGlobalAssistant] = useState(false);
  const [settingsProposal, setSettingsProposal] = useState<
    { routineId: string; value: SettingsProposal } | undefined
  >();
  const [tab, setTab] = useState<
    'settings' | 'live' | 'calendar' | 'history' | 'manage' | 'papers'
  >('history');
  const [calendarTarget, setCalendarTarget] = useState<{
    routineId?: string;
    id: string;
    start: string;
    requestId: number;
  } | null>(null);
  const tabRef = useRef(tab);
  const [briefingTarget, setBriefingTarget] = useState<BriefingNotificationTarget>();
  const scrollPositions = useRef<Record<string, number>>({});
  useEffect(() => {
    if (tab === 'settings' && isGosuEmbedded())
      window.parent.postMessage({ type: 'gosu-open-briefing-settings' }, '*');
  }, [tab]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const receive = (event: MessageEvent) => {
      if (isDesktopNavigation(event)) {
        setGlobalAssistant(event.data.view === 'assistant');
        if (mainScroll.current)
          scrollPositions.current[tabRef.current] = mainScroll.current.scrollTop;
        tabRef.current = event.data.view;
        const candidate = event.data.calendarTarget;
        const notification = BriefingNotificationTargetSchema.safeParse(event.data.briefingTarget);
        setBriefingTarget(
          event.data.view === 'history' && notification.success ? notification.data : undefined,
        );
        const target =
          candidate &&
          parseBriefingItemTarget({ kind: 'calendar', id: candidate.id, start: candidate.start });
        setCalendarTarget(
          target?.kind === 'calendar' && Number.isSafeInteger(candidate.requestId)
            ? {
                id: target.id,
                start: target.start,
                requestId: candidate.requestId,
                ...(typeof candidate.routineId === 'string' && candidate.routineId.length <= 128
                  ? { routineId: candidate.routineId }
                  : {}),
              }
            : null,
        );
        setTab(event.data.view === 'assistant' ? 'history' : event.data.view);
        if (event.data.view === 'assistant') {
          setChatOpen(true);
          setRightCollapsed(false);
          setCopilotOpen(false);
          setRecommendationRequest((n) => n + 1);
        }
        document.documentElement.dataset.gosuView = event.data.view;
      }
    };
    window.addEventListener?.('message', receive);
    return () => window.removeEventListener?.('message', receive);
  }, []);
  const workspace = useMemo(() => withoutSampleContent(suppliedWorkspace), [suppliedWorkspace]);
  const [historyRevision, setHistoryRevision] = useState(0);
  const mainScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabRef.current = tab;
    if (typeof requestAnimationFrame !== 'function') return;
    const frame = requestAnimationFrame(() => {
      if (mainScroll.current) mainScroll.current.scrollTop = scrollPositions.current[tab] ?? 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);
  const [leftCollapsed, setLeftCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 760,
  );
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [leftWidth, setLeftWidth] = useState(264);
  const [rightWidth, setRightWidth] = useState(380);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [paperReference, setPaperReference] = useState<PaperChatReference>();
  useEffect(() => {
    const choose = (event: Event) => {
      const parsed = PaperChatReferenceSchema.safeParse((event as CustomEvent).detail);
      if (!parsed.success || !workspace.routines.some((r) => r.id === parsed.data.routineId))
        return;
      onChange({ ...workspace, selectedRoutineId: parsed.data.routineId });
      setPaperReference(parsed.data);
      setChatOpen(true);
      setCopilotOpen(false);
      setRightCollapsed(false);
    };
    if (typeof window === 'undefined') return;
    window.addEventListener?.(PAPER_CHAT_REFERENCE, choose);
    return () => window.removeEventListener?.(PAPER_CHAT_REFERENCE, choose);
  }, [workspace, onChange]);
  const [recommendationRequest, setRecommendationRequest] = useState(0);
  const [chatBusy, setChatBusy] = useState(false),
    [modelSaving, setModelSaving] = useState(false);
  const [liveResultsByRoutine, setLiveResultsByRoutine] = useState<
    Record<string, LiveSourceResult[]>
  >({});
  const latestWorkspace = useRef(workspace);
  const latestLiveResults = useRef(liveResultsByRoutine);
  latestLiveResults.current = liveResultsByRoutine;
  latestWorkspace.current = workspace;
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<HistoryRemovalReceipt & { restored: boolean }>).detail;
      if (!detail || typeof detail.routineId !== 'string') return;
      if (
        !detail.restored &&
        detail.runId &&
        latestLiveResults.current[detail.routineId]?.some((r) => r.receiptId === detail.runId)
      ) {
        setLiveResultsByRoutine((current) => ({
          ...current,
          [detail.routineId]: (current[detail.routineId] ?? []).filter(
            (r) => r.receiptId !== detail.runId,
          ),
        }));
        if (latestWorkspace.current.selectedRoutineId === detail.routineId)
          setTab((current) => (current === 'live' ? 'history' : current));
      }
    };
    if (typeof window !== 'undefined') window.addEventListener?.(BRIEFING_HISTORY_CHANGED, changed);
    return () => {
      if (typeof window !== 'undefined')
        window.removeEventListener?.(BRIEFING_HISTORY_CHANGED, changed);
    };
  }, []);
  const [deleteError, setDeleteError] = useState('');
  const routine =
    workspace.routines.find((item) => item.id === workspace.selectedRoutineId) ??
    workspace.routines[0];
  const personalRoutines = workspace.routines.filter((item) => item.kind === 'personal');
  const primaryPersonalRoutine = personalRoutines[0] ?? routine;
  const openChatSidebar = () => {
    setChatOpen(true);
    setRecommendationRequest((n) => n + 1);
    setCopilotOpen(false);
    setRightCollapsed(false);
  };
  const select = (routineId: string) => {
    if (workspace.selectedRoutineId !== routineId)
      onChange({ ...workspace, selectedRoutineId: routineId });
    setTab('live');
  };
  const openCalendar = () => {
    if (primaryPersonalRoutine)
      onChange({ ...workspace, selectedRoutineId: primaryPersonalRoutine.id });
    setTab('calendar');
  };
  const openPersonalHistory = () => {
    if (primaryPersonalRoutine)
      onChange({ ...workspace, selectedRoutineId: primaryPersonalRoutine.id });
    setHistoryRevision((revision) => revision + 1);
    if (mainScroll.current) mainScroll.current.scrollTop = 0;
    setTab('history');
  };
  const openManager = () => {
    if (mainScroll.current) mainScroll.current.scrollTop = 0;
    setTab('manage');
  };
  const openPapers = () => {
    if (mainScroll.current) mainScroll.current.scrollTop = 0;
    setTab('papers');
  };
  const save = (updated: BriefingRoutine) =>
    onChange({
      ...latestWorkspace.current,
      routines: latestWorkspace.current.routines.map((item) =>
        item.id === updated.id ? updated : item,
      ),
    });
  const addRoutine = () => {
    const created: BriefingRoutine = {
      id: id(),
      name: '새 브리핑 루틴',
      kind: 'personal',
      state: 'draft',
      schedule: {
        frequency: 'daily',
        interval: 1,
        anchorDate: now().slice(0, 10),
        timeZone: 'Asia/Seoul',
        times: ['08:00'],
        weekdays: [1, 2, 3, 4, 5],
        monthDay: 1,
      },
      interest: { keywords: [], excluded: [] },
      sources: [],
      countries: [],
      createdAt: now(),
      updatedAt: now(),
    };
    onChange({
      ...workspace,
      routines: [...workspace.routines, created],
      selectedRoutineId: created.id,
    });
    setTab('settings');
  };
  const deleteRoutine = async () => {
    if (
      !routine ||
      !window.confirm(
        `“${routine.name}” 루틴을 삭제할까요? 기존 실제 브리핑 기록은 저장소에 유지됩니다.`,
      )
    )
      return;
    setDeleteError('');
    try {
      await sourceRequest(
        '/assistant/settings/deactivate',
        { routineId: routine.id },
        new AbortController().signal,
      );
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : '권한을 해제하지 못해 루틴을 삭제하지 않았습니다.',
      );
      return;
    }
    const routines = latestWorkspace.current.routines.filter((item) => item.id !== routine.id);
    onChange({ ...latestWorkspace.current, routines, selectedRoutineId: routines[0]?.id ?? '' });
    setTab('manage');
  };
  return (
    <div className={`briefing-app${globalAssistant ? ' is-global-assistant' : ''}`}>
      <header className="briefing-topbar">
        <div className="briefing-brand-mark">G</div>
        <div>
          <span>GOSU LABS</span>
          <strong>Briefing Lab</strong>
        </div>
        <span className="briefing-topbar-divider" />
        <span className="briefing-topbar-description">연구의 흐름을 놓치지 않는 아침</span>
        <div className="briefing-phase-badge">
          <span />
          로컬 · Briefing Lab
        </div>
      </header>
      {storageError && (
        <div role="alert" className="briefing-storage-error">
          저장 오류: {storageError}
        </div>
      )}
      {deleteError && (
        <p role="alert" className="briefing-storage-error">
          {deleteError}
        </p>
      )}
      <div
        className={`briefing-workspace ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}
        style={
          {
            '--briefing-left-width': `${leftCollapsed ? 54 : leftWidth}px`,
            '--briefing-right-width': `${rightCollapsed ? 48 : rightWidth}px`,
          } as CSSProperties
        }
      >
        <aside className="briefing-sidebar" aria-label="브리핑 루틴과 실행 이력">
          <header>
            <span className="briefing-section-caption">MY BRIEFINGS</span>
            <button
              className="briefing-icon-button"
              type="button"
              aria-label={leftCollapsed ? '루틴 사이드바 펼치기' : '루틴 사이드바 최소화'}
              onClick={() => setLeftCollapsed(!leftCollapsed)}
            >
              <span className={leftCollapsed ? '' : 'rotate-180'}>
                <Icon name="chevron" />
              </span>
            </button>
          </header>
          {!leftCollapsed ? (
            <>
              <div className="briefing-sidebar-primary-nav" aria-label="독립 세션">
                <button
                  type="button"
                  className={`briefing-sidebar-primary-button ${tab === 'calendar' ? 'selected' : ''}`}
                  onClick={openCalendar}
                  hidden={isGosuEmbedded()}
                  disabled={!primaryPersonalRoutine}
                >
                  <Icon name="calendar" />
                  <span>
                    <strong>Calendar</strong>
                    <small>개인 일정 session</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={`briefing-sidebar-primary-button ${tab === 'history' ? 'selected' : ''}`}
                  onClick={openPersonalHistory}
                >
                  <Icon name="inbox" />
                  <span>
                    <strong>개인 연구 브리핑</strong>
                    <small>전체 History</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={`briefing-sidebar-primary-button ${tab === 'papers' ? 'selected' : ''}`}
                  onClick={openPapers}
                  disabled={!routine}
                >
                  <Icon name="papers" />
                  <span>
                    <strong>논문 요약</strong>
                    <small>보관함 · 검색 · 태그</small>
                  </span>
                </button>
              </div>
              <footer>
                <button type="button" className="briefing-button" onClick={openManager}>
                  <Icon name="settings" />
                  루틴 관리
                </button>
                <button
                  type="button"
                  className="briefing-button primary"
                  onClick={() => {
                    setCopilotOpen(true);
                    setChatOpen(false);
                    setRightCollapsed(false);
                    setRightWidth(390);
                  }}
                >
                  <Icon name="spark" />
                  AI로 새 루틴
                </button>
                <button type="button" className="briefing-button" onClick={addRoutine}>
                  <Icon name="plus" />새 루틴
                </button>
                <small>루틴은 이 브라우저에 저장</small>
              </footer>
            </>
          ) : (
            <div className="briefing-sidebar-collapsed-nav">
              <button
                type="button"
                className={tab === 'calendar' ? 'selected' : ''}
                aria-label="Calendar"
                onClick={openCalendar}
                hidden={isGosuEmbedded()}
              >
                <Icon name="calendar" />
              </button>
              <button
                type="button"
                className={tab === 'history' ? 'selected' : ''}
                aria-label="개인 연구 브리핑"
                onClick={openPersonalHistory}
              >
                <Icon name="inbox" />
              </button>
              <button
                type="button"
                aria-label="논문 요약"
                className={tab === 'papers' ? 'selected' : ''}
                onClick={openPapers}
                disabled={!routine}
              >
                <Icon name="papers" />
              </button>
              <button type="button" className="briefing-sidebar-vertical" onClick={openManager}>
                루틴 관리
              </button>
            </div>
          )}
        </aside>
        {!leftCollapsed ? (
          <Splitter
            label="루틴 사이드바 너비"
            value={leftWidth}
            onChange={setLeftWidth}
            side="left"
          />
        ) : (
          <div className="briefing-splitter-spacer" />
        )}
        <main
          className={`briefing-main${tab === 'calendar' ? ' briefing-main-calendar' : ''}`}
          aria-label={tab === 'calendar' ? 'Calendar' : undefined}
        >
          {tab !== 'calendar' && (
            <header className="briefing-main-header">
              <div>
                <div className="briefing-breadcrumb">
                  {routine ? KIND_LABELS[routine.kind] : 'BRIEFING'} <span>/</span>{' '}
                  {tab === 'live' ? '실제 브리핑' : tab === 'history' ? '개인 연구 브리핑' : '설정'}
                </div>
                <h1>
                  {tab === 'papers'
                    ? '논문 요약'
                    : tab === 'manage'
                      ? '루틴 관리'
                      : tab === 'history'
                        ? '개인 연구 브리핑'
                        : (routine?.name ?? '나만의 브리핑을 시작하세요')}
                </h1>
                <p>
                  {routine
                    ? `${STATE_LABELS[routine.state]} · ${routine.schedule.timeZone}`
                    : '왼쪽에서 새 루틴을 만들어보세요.'}
                </p>
              </div>
              <div className="briefing-main-actions">
                {['history', 'live', 'papers'].includes(tab) && (
                  <BriefingCollapseAll target={mainScroll} />
                )}
                {tab === 'history' && primaryPersonalRoutine?.kind === 'personal' && (
                  <BriefingGenerationControls
                    key={primaryPersonalRoutine.id}
                    routineId={primaryPersonalRoutine.id}
                  />
                )}
              </div>
            </header>
          )}
          {routine &&
            tab !== 'history' &&
            tab !== 'calendar' &&
            tab !== 'manage' &&
            tab !== 'papers' && (
              <nav className="briefing-tabs" aria-label="루틴 보기">
                <button
                  type="button"
                  aria-pressed={tab === 'settings'}
                  className={tab === 'settings' ? 'selected' : ''}
                  onClick={() => setTab('settings')}
                >
                  루틴 설정
                </button>
                <button
                  type="button"
                  aria-pressed={tab === 'live'}
                  className={tab === 'live' ? 'selected' : ''}
                  onClick={() => setTab('live')}
                >
                  실제 브리핑
                </button>
                <span>{tab === 'settings' ? '변경 후 설정을 저장하세요' : ''}</span>
              </nav>
            )}
          <div className="briefing-main-scroll" data-testid="briefing-main-scroll" ref={mainScroll}>
            <div hidden={tab !== 'history'}>
              <BriefingHistoryView
                notificationTarget={briefingTarget}
                key={historyRevision}
                routineIds={[
                  ...personalRoutines.map((item) => item.id),
                  ...(briefingTarget &&
                  workspace.routines.some((r) => r.id === briefingTarget.routineId)
                    ? [briefingTarget.routineId]
                    : []),
                ]}
              />
            </div>
            {tab === 'papers' && routine ? (
              <>
                {workspace.routines.length > 1 && (
                  <label className="briefing-paper-routine">
                    브리핑 루틴
                    <select
                      aria-label="논문 보관함 루틴"
                      value={routine.id}
                      onChange={(event) =>
                        onChange({ ...workspace, selectedRoutineId: event.target.value })
                      }
                    >
                      {workspace.routines.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <SavedPaperSummaries key={routine.id} routineId={routine.id} />
              </>
            ) : tab === 'history' ? null : tab === 'manage' ? (
              <RoutineManager
                workspace={workspace}
                onCollect={(id) => select(id)}
                onSettings={(id) => {
                  select(id);
                  setTab('settings');
                }}
              />
            ) : routine && tab === 'live' ? (
              <LiveBriefingView
                key={routine.id}
                routine={routine}
                {...(liveResultsByRoutine[routine.id]
                  ? { initialResults: liveResultsByRoutine[routine.id] }
                  : {})}
                onResultsChange={(next) =>
                  setLiveResultsByRoutine((current) => ({ ...current, [routine.id]: next }))
                }
                onSettings={() => {
                  setTab('settings');
                  globalThis.requestAnimationFrame?.(() =>
                    document
                      .querySelector('.briefing-live-settings')
                      ?.scrollIntoView({ block: 'start' }),
                  );
                }}
              />
            ) : routine && tab === 'calendar' ? (
              <CalendarView
                key={calendarTarget?.requestId ?? 'calendar'}
                target={calendarTarget}
                routine={
                  workspace.routines.find((r) => r.id === calendarTarget?.routineId) ?? routine
                }
                onSettings={() => setTab('settings')}
              />
            ) : routine && tab === 'settings' ? (
              <RoutineSettings
                key={`${routine.id}:${routine.createdAt}:${JSON.stringify(settingsProposal)}`}
                routine={routine}
                {...(settingsProposal?.routineId === routine.id
                  ? { proposal: settingsProposal.value }
                  : {})}
                onSave={(next) => {
                  save(next);
                  setSettingsProposal(undefined);
                }}
                onDelete={deleteRoutine}
              />
            ) : (
              <div className="briefing-empty">
                <h2>아직 설정된 루틴이 없습니다.</h2>
                <p>새 루틴을 만들고 실제 소스를 연결해 브리핑을 시작하세요.</p>
              </div>
            )}
          </div>
        </main>
        {!rightCollapsed ? (
          <Splitter
            label="상세 사이드바 너비"
            value={rightWidth}
            onChange={setRightWidth}
            side="right"
          />
        ) : (
          <div className="briefing-splitter-spacer" />
        )}
        <aside
          className={`briefing-details ${chatOpen && !rightCollapsed ? 'chat-open' : ''}`}
          aria-label="브리핑 상세 정보"
        >
          <header>
            <span className="briefing-section-caption">
              {chatOpen ? 'GOSU AI' : copilotOpen ? 'ROUTINE COPILOT' : 'ROUTINE OVERVIEW'}
            </span>
            {chatOpen && routine && !rightCollapsed && (
              <BriefingModelMenu
                key={routine.id}
                routine={routine}
                busy={chatBusy}
                onSavingChange={setModelSaving}
                onSettings={() => setTab('settings')}
                onSaved={(selection) => {
                  const current = latestWorkspace.current.routines.find((r) => r.id === routine.id);
                  if (!current) return;
                  const live = current.live ?? defaultLiveSettings();
                  save({
                    ...current,
                    updatedAt: now(),
                    live: {
                      ...live,
                      assistant: {
                        ...(live.assistant ?? defaultAssistantPreferences()),
                        ...selection,
                      },
                    },
                  });
                }}
              />
            )}
            <button
              type="button"
              className="briefing-icon-button"
              aria-label={rightCollapsed ? '상세 사이드바 펼치기' : '상세 사이드바 최소화'}
              title={rightCollapsed ? 'AI 채팅 열기' : '사이드바 닫기'}
              onClick={() => (rightCollapsed ? openChatSidebar() : setRightCollapsed(true))}
            >
              <span className={rightCollapsed ? 'rotate-180' : ''}>
                <Icon name="chevron" />
              </span>
            </button>
          </header>
          {rightCollapsed && (
            <button type="button" className="briefing-sidebar-vertical" onClick={openChatSidebar}>
              AI 비서
            </button>
          )}
          <div className="briefing-details-scroll" hidden={rightCollapsed}>
            <RetainedBriefingChats
              globalMode={globalAssistant}
              paperReference={paperReference}
              routines={workspace.routines}
              selectedId={routine?.id}
              visible={chatOpen && !rightCollapsed}
              recommendationRequest={recommendationRequest}
              onBusyChange={setChatBusy}
              blocked={modelSaving}
              onSettings={(proposal) => {
                setSettingsProposal(
                  proposal && routine ? { routineId: routine.id, value: proposal } : undefined,
                );
                setTab('settings');
              }}
            />
            {chatOpen ? null : copilotOpen ? (
              <>
                <button
                  type="button"
                  className="briefing-text-button"
                  onClick={() => setCopilotOpen(false)}
                >
                  루틴 한눈에 보기
                </button>
                <RoutineCopilot
                  onCreate={(created) => {
                    if (workspace.routines.length >= 100) throw new Error('routine_limit');
                    onChange({
                      ...workspace,
                      routines: [...workspace.routines, created],
                      selectedRoutineId: created.id,
                    });
                    setTab('settings');
                  }}
                />
              </>
            ) : (
              <>
                {routine && (
                  <>
                    <section>
                      <div className="briefing-details-title">
                        <Icon name="calendar" />
                        <h2>루틴 한눈에</h2>
                      </div>
                      <div className="briefing-schedule-display">
                        <strong>{routine.schedule.times.join(' / ')}</strong>
                        <span>
                          {routine.schedule.interval}
                          {routine.schedule.frequency === 'daily'
                            ? '일'
                            : routine.schedule.frequency === 'weekly'
                              ? '주'
                              : '개월'}
                          마다 · {STATE_LABELS[routine.state]}
                        </span>
                      </div>
                      <Preview schedule={routine.schedule} />
                    </section>
                    <section>
                      <h2>연구 관심사</h2>
                      <div className="briefing-tags">
                        {routine.interest.keywords.map((keyword) => (
                          <span key={keyword.term}>
                            {keyword.term} <b>×{keyword.weight}</b>
                          </span>
                        ))}
                        {!routine.interest.keywords.length && (
                          <p className="briefing-muted">루틴 설정에서 키워드를 추가하세요.</p>
                        )}
                      </div>
                      <p className="briefing-muted">
                        제목·초록 관련성 우선 · 기존 회차는 생성 당시 조건을 유지합니다.
                      </p>
                    </section>
                  </>
                )}
                <section className="briefing-copilot-placeholder">
                  <span className="briefing-section-caption">BRIEFING COPILOT</span>
                  <Icon name="spark" />
                  <h2>GOSU 엔진으로 루틴 만들기</h2>
                  <p>
                    Codex / Claude Code로 시간표와 연구 관심사를 정리하고, 제안을 검토한 뒤 초안으로
                    추가하세요.
                  </p>
                  <button
                    type="button"
                    className="briefing-button"
                    onClick={() => {
                      setCopilotOpen(true);
                      setRightWidth(390);
                    }}
                  >
                    AI로 루틴 설계
                  </button>
                </section>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
