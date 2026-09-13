import { createRoot } from 'react-dom/client';
import { WeatherCard } from '../src/weather-card';
import { BriefingInsightCard } from '../src/briefing-insight-card';
import { BriefingMemoryPanel } from '../src/briefing-memory-panel';
import { MailConnectionCard } from '../src/mail-connection-settings';
import type { LiveItem, WeatherSeries } from '../src/live-types';
import type { PaperInsight } from '../src/briefing-intelligence';
import '../src/styles.css';
import publicResult from '../../../tmp/briefing-intelligence/public-result.json';
const mode = new URLSearchParams(location.search).get('mode');
const weather = publicResult.weather as WeatherSeries;
const variants = [
  { name: '비 · 시각 검증용 합성 예보', code: 63, temperature: 22 },
  { name: '눈/추위 · 시각 검증용 합성 예보', code: 73, temperature: -12 },
  { name: '더위 · 시각 검증용 합성 예보', code: 0, temperature: 37 },
];
createRoot(document.getElementById('root')!).render(
  <div className="briefing-app" style={{ overflow: 'auto' }}>
    <header className="briefing-topbar">
      <div className="briefing-brand-mark">B</div>
      <div>
        <span>GOSU BRIEFING LAB</span>
        <strong>오늘, 연구에 집중할 수 있도록.</strong>
      </div>
      <span className="briefing-topbar-description">
        {mode === 'mail'
          ? '메일 연결 UI 검증 · 가상 계정'
          : mode === 'weather'
            ? '날씨 시각 회귀 검증'
            : '실제 공개 자료 · native LLM 검증'}
      </span>
    </header>
    <main
      style={{
        width: '100%',
        maxWidth: 850,
        margin: '0 auto',
        padding: '0 20px 24px',
        flexShrink: 0,
      }}
    >
      {mode === 'mail' ? (
        <section style={{ paddingTop: 24 }}>
          <h2>메일 연결 상태 · UI 검증용 가상 계정</h2>
          <p>실제 연결/메일이 아닌 상태별 시각 검증입니다.</p>
          {(['connected', 'prepared', 'loading', 'expired'] as const).map((phase) => (
            <MailConnectionCard
              key={phase}
              phase={phase}
              accountName="Research · research@example.test"
              mailboxName="받은 편지함 / Google Scholar"
              scope={{
                accountId: 'fixture',
                mailboxId: 'fixture',
                days: 3,
                limit: 10,
                subject: '',
                sender: '',
                unreadOnly: false,
                bodyPreview: true,
              }}
              expiresAt="2026-09-09T03:30:00Z"
              checkedAt="2026-09-09T03:00:00Z"
            />
          ))}
        </section>
      ) : mode === 'weather' ? (
        variants.map((v) => (
          <WeatherCard
            key={v.code}
            weather={{
              ...weather,
              city: v.name,
              code: v.code,
              temperature: v.temperature,
              hours: weather.hours.map((h, i) => ({
                ...h,
                temperature: v.temperature + Math.sin(i / 4) * 3,
                code: v.code,
                precipitation: v.code ? 70 : 5,
              })),
            }}
          />
        ))
      ) : (
        <>
          <WeatherCard weather={weather} />
          <BriefingMemoryPanel routineId="visual-only" onSession={() => undefined} />
          <p className="briefing-section-caption">
            RESEARCH · {publicResult.result.invocation.model} · 실제 분석
          </p>
          <BriefingInsightCard
            item={publicResult.item as LiveItem}
            paper={publicResult.item.paper as LiveItem['paper']}
            insight={publicResult.insight as PaperInsight}
            memory={null}
            routineId="visual-only"
          />
        </>
      )}
    </main>
  </div>,
);
