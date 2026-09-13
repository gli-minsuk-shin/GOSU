import { useId, useState, useEffect, useRef } from 'react';
import type { WeatherSeries } from './live-types';
export function weatherCondition(code: number | null) {
  if (code === null) return 'unknown';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if (code >= 95) return 'storm';
  if (code >= 51) return 'rain';
  if (code >= 45) return 'fog';
  if (code > 0) return 'cloud';
  return 'sun';
}
export function WeatherGlyph({ kind }: { kind: ReturnType<typeof weatherCondition> }) {
  return (
    <svg viewBox="0 0 80 64" fill="none" aria-hidden="true" className={`weather-glyph ${kind}`}>
      {(kind === 'sun' || kind === 'cloud') && (
        <g stroke="#c39b36" strokeWidth="3" strokeLinecap="round">
          <circle cx="48" cy="22" r="12" fill="#fbefd0" />
          <path d="M48 3v-2M48 43v3M29 22h-4M68 22h4M34 8l-3-3M62 8l3-3" />
        </g>
      )}
      {kind !== 'sun' && (
        <path
          d="M20 42a12 12 0 0 1-1-24 17 17 0 0 1 32-1 13 13 0 1 1 10 25Z"
          fill="#ecf1f5"
          stroke="#7e93a3"
          strokeWidth="2.5"
        />
      )}
      {(kind === 'rain' || kind === 'storm') && (
        <g stroke="#4d7ea8" strokeWidth="3" strokeLinecap="round">
          <path d="m24 48-3 6m20-6-3 6m20-6-3 6" />
        </g>
      )}
      {kind === 'snow' && (
        <g stroke="#4d7ea8" strokeWidth="2">
          <path d="M24 48v12m-5-9 10 6m0-6-10 6M51 48v12m-5-9 10 6m0-6-10 6" />
        </g>
      )}
      {kind === 'storm' && <path d="m43 35-7 12h8l-5 13 18-20H45l6-5" fill="#b9943f" />}
      {kind === 'fog' && <path d="M16 50h48M22 57h35" stroke="#7e93a3" strokeWidth="2.5" />}
    </svg>
  );
}
export function weatherPlot(hours: WeatherSeries['hours'], width = 580) {
  const valid = hours.flatMap((h) => (h.temperature === null ? [] : [h.temperature]));
  if (!valid.length) return { path: '', low: 0, high: 1, points: [] };
  const low = Math.floor(Math.min(...valid) - 2),
    high = Math.ceil(Math.max(...valid) + 2);
  let connected = false;
  const points = hours.map((h, i) => ({
    x: 42 + (i * (width - 70)) / Math.max(1, hours.length - 1),
    y: h.temperature === null ? null : 92 - ((h.temperature - low) * 68) / (high - low),
  }));
  const path = points
    .map((p) => {
      if (p.y === null) {
        connected = false;
        return '';
      }
      const command = connected ? 'L' : 'M';
      connected = true;
      return `${command}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');
  return { path, low, high, points };
}
export function precipitationBarHeight(probability: number | null) {
  if (probability === null || probability <= 0) return 0;
  return Math.max(3, Math.min(100, probability) * 0.52);
}
export function WeatherCard({
  weather,
  historical = false,
}: {
  weather: WeatherSeries;
  historical?: boolean;
}) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const minimumWidth = Math.max(580, weather.hours.length * 25 + 70);
  const [chartWidth, setChartWidth] = useState(minimumWidth);
  const [scrollable, setScrollable] = useState(false);
  const chart = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!chart.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) {
        setChartWidth(Math.max(minimumWidth, entry.contentRect.width));
        setScrollable(entry.contentRect.width < minimumWidth);
      }
    });
    observer.observe(chart.current);
    return () => observer.disconnect();
  }, [weather.hours.length]);
  const plot = weatherPlot(weather.hours, chartWidth);
  const staggerLabels = (chartWidth - 70) / Math.max(1, weather.hours.length - 1) < 34;
  const valid = weather.hours.flatMap((h) => (h.temperature === null ? [] : [h.temperature]));
  const current = active === null ? null : weather.hours[active];
  const condition = weatherCondition(weather.code),
    labels = {
      sun: '맑음',
      cloud: '구름',
      rain: '비',
      snow: '눈',
      storm: '뇌우',
      fog: '안개',
      unknown: '상태 미제공',
    };
  const hour = (time: number) =>
    new Intl.DateTimeFormat('ko-KR', {
      timeZone: weather.timeZone,
      hour: '2-digit',
      hour12: false,
    }).format(new Date(time * 1000));
  const hot = valid.some((t) => t >= 35) || (weather.temperature ?? -Infinity) >= 35,
    cold = valid.some((t) => t <= -10) || (weather.temperature ?? Infinity) <= -10;
  const rain = weather.hours.some((h) => ['rain', 'storm'].includes(weatherCondition(h.code))),
    snow = weather.hours.some((h) => weatherCondition(h.code) === 'snow');
  return (
    <article className={`briefing-weather-card ${cold ? 'cold' : hot ? 'hot' : condition}`}>
      <div className="weather-header">
        <div>
          <span className="briefing-section-caption">
            {historical ? '당시 예보' : 'TODAY'} · {weather.city}
          </span>
          <div className="weather-temperature">
            {weather.temperature === null ? '—' : Math.round(weather.temperature)}
            <small>°C</small>
            <span>{labels[condition]}</span>
          </div>
          <p>
            {valid.length
              ? `최저 ${Math.min(...valid).toFixed(0)}° · 최고 ${Math.max(...valid).toFixed(0)}°`
              : '시간별 예보 미제공'}{' '}
            · 바람 {weather.wind ?? '—'} km/h
          </p>
        </div>
        <WeatherGlyph kind={condition} />
      </div>
      <div className="weather-alerts">
        {hot && <span>♨ 35°C 이상 예보</span>}
        {cold && <span>❄ −10°C 이하 예보</span>}
        {rain && <span>☂ 비 예보</span>}
        {snow && <span>❄ 눈 예보</span>}
      </div>
      <div className="weather-chart-heading">
        <strong>
          {historical ? '당시 시간별 기온 · 강수확률' : '오늘 시간별 기온 · 강수확률'}
        </strong>
        <span className="weather-chart-legend">
          <i className="weather-legend-temperature" /> 기온
          <i className="weather-legend-precipitation" /> 강수확률
          <em>
            {weather.localDate} · {weather.timeZone}
          </em>
        </span>
      </div>
      {valid.length > 1 ? (
        <div
          ref={chart}
          className="weather-chart-scroll"
          role="region"
          aria-label="시간별 예보 그래프 · 좁은 화면에서는 좌우로 스크롤"
          tabIndex={0}
        >
          <svg
            className="weather-chart"
            style={{ fontSize: 11, minWidth: minimumWidth }}
            viewBox={`0 0 ${chartWidth} 218`}
            role="img"
            aria-labelledby={id}
          >
            <title
              id={id}
            >{`시간별 기온과 강수확률 예보. ${weather.hours.length}개 시간대. 결측 기온 구간은 연결하지 않습니다.`}</title>
            {[plot.low, (plot.high + plot.low) / 2, plot.high].map((t) => (
              <g key={t}>
                <path
                  d={`M42 ${92 - ((t - plot.low) * 68) / (plot.high - plot.low)} H${chartWidth - 25}`}
                  stroke="#e1e6dc"
                />
                <text
                  x="32"
                  y={96 - ((t - plot.low) * 68) / (plot.high - plot.low)}
                  textAnchor="end"
                >
                  {t.toFixed(0)}°
                </text>
              </g>
            ))}
            <path d={plot.path} stroke="#5c803a" strokeWidth="2.5" fill="none" />
            <rect
              className="weather-rain-band"
              x="30"
              y="103"
              width={chartWidth - 43}
              height="92"
              rx="6"
            />
            <path d={`M42 192H${chartWidth - 25}`} stroke="#d4e1ec" />
            {weather.hours.map((h, i) => {
              const p = plot.points[i]!;
              const precipitation =
                h.precipitation === null ? null : Math.max(0, Math.min(100, h.precipitation));
              const precipitationHeight = precipitationBarHeight(precipitation);
              const precipitationWidth = Math.min(
                18,
                Math.max(8, ((chartWidth - 70) / weather.hours.length) * 0.55),
              );
              return (
                <g key={h.time}>
                  {i % 6 === 0 || i === weather.hours.length - 1 ? (
                    <text x={p.x} y="211" textAnchor="middle">
                      {hour(h.time)}
                    </text>
                  ) : null}
                  {p.y !== null && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={active === i ? 5 : 3}
                      fill={active === i ? '#527d0b' : '#fff'}
                      stroke="#5c803a"
                      tabIndex={0}
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onClick={() => setActive(i)}
                      onMouseLeave={() => setActive(null)}
                      onBlur={() => setActive(null)}
                    >
                      <title>{`${hour(h.time)} · ${h.temperature}°C · 강수확률 ${h.precipitation ?? '미제공'}%`}</title>
                    </circle>
                  )}
                  {precipitation !== null && (
                    <rect
                      className={`weather-precipitation-bar${precipitation === 0 ? ' is-zero' : ''}`}
                      data-probability={precipitation}
                      x={p.x - precipitationWidth / 2}
                      y={precipitation === 0 ? 192 : 192 - precipitationHeight}
                      width={precipitationWidth}
                      height={precipitation === 0 ? 2 : precipitationHeight}
                      rx="3"
                      tabIndex={0}
                      onMouseEnter={() => setActive(i)}
                      onMouseLeave={() => setActive(null)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                      onClick={() => setActive(i)}
                    >
                      <title>{`${hour(h.time)} · 강수확률 ${precipitation}% · 기온 ${h.temperature ?? '미제공'}°C`}</title>
                    </rect>
                  )}
                  <text
                    className={`weather-probability-label${precipitation === 0 ? ' is-zero' : ''}`}
                    x={p.x}
                    y={staggerLabels && i % 2 ? 130 : 117}
                    textAnchor="middle"
                  >
                    {precipitation === null ? '—' : `${precipitation}%`}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <p>시간별 그래프를 그릴 충분한 예보가 없습니다.</p>
      )}
      <div className="weather-footnote">
        {current
          ? `${hour(current.time)} · ${current.temperature ?? '—'}°C · 체감 ${current.apparent ?? '—'}°C · 강수확률 ${current.precipitation ?? '—'}%`
          : `파란 숫자·막대: 강수확률 · 0%는 기준선, —는 미제공 · 아주 낮은 확률은 최소 높이로 표시${scrollable ? ' · 좌우로 스크롤해 모든 시간대 확인' : ''}`}
      </div>
      <small className="weather-source">
        Open-Meteo 예보 · 기준{' '}
        {Number.isFinite(Date.parse(weather.currentTime))
          ? new Intl.DateTimeFormat('ko-KR', {
              timeZone: weather.timeZone,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(new Date(weather.currentTime))
          : '시각 미제공'}{' '}
        · 공식 기상특보가 아닌 참고 표시 ·{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          출처
        </a>
      </small>
    </article>
  );
}
