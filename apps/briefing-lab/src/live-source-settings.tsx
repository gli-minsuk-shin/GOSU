import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  defaultLiveSettings,
  type BriefingRoutine,
  type LiveSettings,
  type WeatherLocation,
} from '@gosu/briefing-core';
import { sourceRequest } from './live-client';
import { MailConnectionSettings } from './mail-connection-settings';
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="briefing-field">
    <span>{label}</span>
    {children}
  </label>
);
export function LiveSourceSettings({
  routine,
  onChange,
}: {
  routine: BriefingRoutine;
  onChange: (live: LiveSettings) => void;
}) {
  const live = routine.live ?? defaultLiveSettings();
  const [cityQuery, setCityQuery] = useState(''),
    [cities, setCities] = useState<WeatherLocation[]>([]);
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const work = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (busy) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setStatus('연결 확인 중…');
    try {
      await task(c.signal);
    } catch (error) {
      if (!c.signal.aborted) setStatus(error instanceof Error ? error.message : '연결 실패');
    } finally {
      if (controller.current === c) {
        controller.current = null;
        setBusy(false);
      }
    }
  };
  if (routine.kind === 'funding') return null;
  return (
    <section
      className="briefing-settings-section briefing-live-settings"
      aria-label="실제 소스 연결 설정"
    >
      <header>
        <span className="briefing-step">05</span>
        <div>
          <h2>실제 이메일 · 날씨 · 논문 연결</h2>
          <p>
            실제 조회에 사용할 조건입니다. 변경 후 아래 설정 저장을 눌러 루틴에 적용하세요. 자동
            예약은 아직 실행하지 않습니다.
          </p>
        </div>
      </header>
      <fieldset>
        <legend>날씨 · Open-Meteo</legend>
        <p>
          도시 검색어와 선택한 도시 좌표만 Open-Meteo에 전송합니다. 현재 위치는 자동으로 읽지
          않습니다.
        </p>
        <div className="briefing-form-grid">
          <Field label="날씨 도시 검색">
            <input
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              placeholder="예: 서울 또는 Seoul"
            />
          </Field>
          <button
            className="briefing-button"
            type="button"
            disabled={busy || cityQuery.trim().length < 2}
            onClick={() =>
              void work(async (signal) => {
                const result = await sourceRequest<{ cities: WeatherLocation[] }>(
                  '/cities',
                  { query: cityQuery },
                  signal,
                );
                setCities(result.cities);
                setStatus(
                  result.cities.length
                    ? '도시 후보에서 선택해주세요.'
                    : '도시를 찾지 못했습니다. 영문 이름도 시도할 수 있습니다.',
                );
              })
            }
          >
            도시 찾기
          </button>
        </div>
        {cities.length > 0 && (
          <Field label="날씨 도시 선택">
            <select
              value={live.weather?.id ?? ''}
              onChange={(e) => {
                const city = cities.find((item) => item.id === Number(e.target.value));
                if (city) onChange({ ...live, weather: city });
              }}
            >
              <option value="">도시 선택</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name} · {city.country} · {city.timeZone}
                </option>
              ))}
            </select>
          </Field>
        )}
        {live.weather && (
          <p>
            선택한 도시:{' '}
            <strong>
              {live.weather.name} · {live.weather.country}
            </strong>{' '}
            <button
              type="button"
              className="briefing-text-button"
              onClick={() => onChange({ ...live, weather: null })}
            >
              날씨 제외
            </button>
          </p>
        )}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo · CC BY 4.0 · 비상업용 공개 endpoint
        </a>
      </fieldset>
      <fieldset>
        <legend>연구 논문 · arXiv · Google Scholar 알림</legend>
        <label>
          <input
            type="checkbox"
            checked={live.papers.scholarAlerts ?? true}
            onChange={(e) =>
              onChange({ ...live, papers: { ...live.papers, scholarAlerts: e.target.checked } })
            }
          />{' '}
          Google Scholar 알림 메일의 논문도 포함
        </label>
        <p className="briefing-muted">
          선택한 메일함의 조회 기간·개수 안에서 논문 링크와 알림 발췌를 추출합니다. 메일 읽기·본문
          미리보기 허용이 필요하며, AI 요약에는 메일 AI 전송 허용도 필요합니다. 추적·구독 취소
          링크는 열지 않습니다.
        </p>
        <label>
          <input
            type="checkbox"
            checked={live.papers.enabled}
            onChange={(e) =>
              onChange({ ...live, papers: { ...live.papers, enabled: e.target.checked } })
            }
          />{' '}
          arXiv 논문 검색 포함
        </label>
        <p>
          이 루틴에 저장한 연구 키워드·가중치·동의어·제외어를 사용합니다:{' '}
          <strong>
            {routine.interest.keywords.map((k) => k.term).join(', ') ||
              '위의 연구 주제를 먼저 입력해주세요.'}
          </strong>
        </p>
        <div className="briefing-form-grid">
          <Field label="논문 검색 기간 (최근 일수)">
            <input
              type="number"
              min={1}
              max={3650}
              value={live.papers.days}
              onChange={(e) =>
                onChange({ ...live, papers: { ...live.papers, days: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="논문 최대 표시 수">
            <input
              type="number"
              min={1}
              max={30}
              value={live.papers.limit}
              onChange={(e) =>
                onChange({ ...live, papers: { ...live.papers, limit: Number(e.target.value) } })
              }
            />
          </Field>
          <Field label="논문 저자 (선택)">
            <input
              value={live.papers.author}
              maxLength={120}
              onChange={(e) =>
                onChange({ ...live, papers: { ...live.papers, author: e.target.value } })
              }
            />
          </Field>
        </div>
        <p className="briefing-muted">
          수집 후 실제 브리핑에서 LLM 요약·중요도·프로젝트 연관성 분석을 요청할 수 있습니다. 원문
          접근이 제한되면 읽은 범위를 표시합니다.
        </p>
      </fieldset>
      <MailConnectionSettings
        key={routine.id}
        routineId={routine.id}
        managedBySettings
        value={live.mail}
        onChange={(mail) =>
          onChange({
            ...live,
            mail,
            ...(!mail && live.assistant
              ? { assistant: { ...live.assistant, mailRead: false } }
              : {}),
          })
        }
      />
      {status && (
        <p role="status" className="briefing-alert">
          {status}
        </p>
      )}
      {busy && (
        <button
          type="button"
          className="briefing-button"
          onClick={() => {
            controller.current?.abort();
            setStatus('연결 요청을 중단했습니다.');
          }}
        >
          연결 요청 중단
        </button>
      )}
    </section>
  );
}
