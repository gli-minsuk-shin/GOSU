import type { WeatherSeries } from './live-types';
import type { BriefingSnapshot } from './briefing-history-snapshot';
import { WeatherGlyph, weatherCondition } from './weather-card';
import { agendaDays } from './briefing-agenda-days';
const labels = {
  sun: '맑음',
  cloud: '구름',
  rain: '비',
  snow: '눈',
  storm: '뇌우',
  fog: '안개',
  unknown: '상태 미제공',
};
export function BriefingWeatherPeek({ weather }: { weather?: WeatherSeries | undefined }) {
  if (!weather) return <span className="briefing-collapsed-peek">저장된 날씨 없음</span>;
  const kind = weatherCondition(weather.code);
  const temperatures = weather.hours.flatMap((h) =>
    h.temperature === null ? [] : [h.temperature],
  );
  const rain = weather.hours.flatMap((h) => (h.precipitation === null ? [] : [h.precipitation]));
  return (
    <span className="briefing-collapsed-peek" aria-label="접힌 날씨 요약">
      <WeatherGlyph kind={kind} />
      <span className="briefing-peek-location" title={weather.city}>
        {weather.city}
      </span>
      <strong>
        {weather.temperature === null ? '기온 정보 없음' : `${Math.round(weather.temperature)}°C`} ·{' '}
        {labels[kind]}
      </strong>
      {temperatures.length > 0 && (
        <span>
          {Math.round(Math.min(...temperatures))}~{Math.round(Math.max(...temperatures))}°
        </span>
      )}
      <span>{rain.length ? `강수 최대 ${Math.round(Math.max(...rain))}%` : '강수 정보 없음'}</span>
    </span>
  );
}
export function BriefingAgendaPeek({
  events,
  referenceAt,
  timeZone,
}: {
  events: NonNullable<BriefingSnapshot['calendar']>;
  referenceAt: string;
  timeZone: string;
}) {
  const days = agendaDays(referenceAt, timeZone, events);
  const remaining = [...new Set(days.flatMap((d) => d.events))]
    .filter((e) => Date.parse(e.end) > Date.parse(referenceAt))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const next = remaining[0];
  return (
    <span className="briefing-collapsed-peek" aria-label="접힌 일정 요약">
      <span>
        오늘 {days[0]!.events.length}개 · 내일 {days[1]!.events.length}개
      </span>
      {next ? (
        <strong className="briefing-peek-event" title={next.title}>
          {Date.parse(next.start) < Date.parse(referenceAt)
            ? '진행 중'
            : `다음 · ${days[0]!.events.includes(next) ? '오늘' : '내일'}`}{' '}
          ·{' '}
          {next.allDay
            ? '종일'
            : new Intl.DateTimeFormat('ko-KR', {
                timeZone,
                hour: 'numeric',
                minute: '2-digit',
              }).format(new Date(next.start))}{' '}
          {next.title}
        </strong>
      ) : (
        <span>브리핑 기준 남은 일정 없음</span>
      )}
    </span>
  );
}
