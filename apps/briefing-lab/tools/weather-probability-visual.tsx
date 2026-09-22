import { createRoot } from 'react-dom/client';
import { WeatherCard } from '../src/weather-card';
import type { WeatherSeries } from '../src/live-types';
import '../src/styles.css';
import '../src/workspace.css';
const probabilities = [
  0,
  0,
  1,
  5,
  10,
  20,
  30,
  45,
  60,
  80,
  100,
  90,
  70,
  50,
  35,
  20,
  10,
  5,
  0,
  null,
  0,
  0,
  0,
  0,
];
function weather(values: (number | null)[]): WeatherSeries {
  return {
    city: '서울 · 검증용 예보',
    timeZone: 'Asia/Seoul',
    localDate: '2026-09-13',
    currentTime: '2026-09-13T09:00:00+09:00',
    temperature: 24,
    code: 3,
    wind: 6,
    hours: values.map((precipitation, i) => ({
      time: 1789225200 + i * 3600,
      temperature: 24 + Math.sin(i / 4) * 3,
      apparent: 24,
      precipitation,
      code: 3,
    })),
  };
}
const narrow = new URLSearchParams(location.search).has('narrow');
const compact = new URLSearchParams(location.search).has('compact');
const dry = new URLSearchParams(location.search).has('dry');
createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 16, maxWidth: narrow ? 380 : 1200, margin: 'auto' }}>
    <h2>시간별 날씨 · 합성 화면 검증</h2>
    {!narrow && (
      <div className={compact ? 'briefing-history-run' : undefined}>
        <WeatherCard weather={weather(dry ? Array(24).fill(0) : probabilities)} />
      </div>
    )}
    <div style={{ maxWidth: 380, marginTop: 20 }}>
      <WeatherCard weather={weather(Array(24).fill(0))} historical />
    </div>
  </main>,
);
