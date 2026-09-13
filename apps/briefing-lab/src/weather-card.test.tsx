import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { WeatherCard, weatherCondition, weatherPlot, precipitationBarHeight } from './weather-card';
import type { WeatherSeries } from './live-types';
const hours = [-12, -9, null, -5, 0].map((temperature, i) => ({
  time: 1788912000 + i * 3600,
  temperature,
  apparent: temperature,
  precipitation: 80,
  code: 73,
}));
const weatherWithRain = (values: (number | null)[]): WeatherSeries => ({
  city: 'Test',
  timeZone: 'Asia/Seoul',
  localDate: '2026-09-09',
  currentTime: '2026-09-09T00:00:00Z',
  temperature: 20,
  code: 3,
  wind: 5,
  hours: values.map((precipitation, i) => ({
    time: 1788912000 + i * 3600,
    temperature: 20,
    apparent: 20,
    precipitation,
    code: 3,
  })),
});
describe('compact weather evidence', () => {
  it('keeps the source footer full-width in History as well as Live to avoid a tall empty grid row', () => {
    const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
    const rule = css
      .split(':is(.briefing-live-view, .briefing-history-run) .weather-source {')[1]!
      .split('}')[0]!;
    expect(rule).toContain('grid-column: 1/-1');
    expect(rule).toContain('grid-row: 5');
  });
  it('labels every known probability and gives positive bars a taller readable scale without treating null as zero', () => {
    const html = renderToStaticMarkup(
      <WeatherCard weather={weatherWithRain([0, 50, null, 0, 1])} />,
    );
    expect(html.match(/class="weather-precipitation-bar/g)).toHaveLength(4);
    expect(html.match(/data-probability="0"/g)).toHaveLength(2);
    expect(html.match(/>0%<\/text>/g)).toHaveLength(2);
    const bars = html.match(/<rect class="weather-precipitation-bar[^>]+>/g)!;
    expect(bars[0]).toContain('y="192"');
    expect(bars[0]).toContain('height="2"');
    expect(bars[1]).toContain('height="26"');
    expect(bars[3]).toContain('height="3"');
    expect(html).toContain('>50%</text>');
    expect(html).toContain('>1%</text>');
    expect(html).toContain('>—</text>');
    expect(html).toContain('강수확률 0%');
    expect(html).toContain('viewBox="0 0 580 218"');
  });
  it('keeps all hourly labels readable in a contained scroller including historical and DST days', () => {
    const weather = weatherWithRain(Array(24).fill(0));
    const html = renderToStaticMarkup(<WeatherCard weather={weather} historical />);
    expect(html.match(/data-probability="0"/g)).toHaveLength(24);
    expect(html).toContain('당시 예보');
    expect(html).toContain('>0%</text>');
    expect(html.match(/>0%<\/text>/g)).toHaveLength(24);
    expect(html).toContain('min-width:670px');
    expect(html).toContain('y="130"');
    expect(html).toContain('weather-chart-scroll');
    const dst = renderToStaticMarkup(
      <WeatherCard weather={weatherWithRain(Array(25).fill(100))} />,
    );
    expect(dst.match(/>100%<\/text>/g)).toHaveLength(25);
    expect(dst).toContain('min-width:695px');
    expect(
      renderToStaticMarkup(<WeatherCard weather={weatherWithRain([null, null, null])} />),
    ).not.toContain('weather-precipitation-bar');
  });
  it('keeps the positive scale proportional above its disclosed minimum and never invents zero/missing rain', () => {
    expect(precipitationBarHeight(100)).toBe(52);
    expect(precipitationBarHeight(50)).toBe(26);
    expect(precipitationBarHeight(10)).toBe(5.2);
    expect(precipitationBarHeight(1)).toBe(3);
    expect(precipitationBarHeight(0)).toBe(0);
    expect(precipitationBarHeight(null)).toBe(0);
  });
  it('maps rain/snow/storm distinctly and never bridges missing temperature values', () => {
    expect(weatherCondition(73)).toBe('snow');
    expect(weatherCondition(61)).toBe('rain');
    expect(weatherCondition(95)).toBe('storm');
    expect(weatherCondition(null)).toBe('unknown');
    expect(weatherPlot(hours).path.match(/M/g)).toHaveLength(2);
    expect(weatherPlot(hours).low).toBeLessThan(-12);
    expect(weatherPlot(hours.map((h) => ({ ...h, temperature: 7 }))).path).not.toContain('NaN');
  });
  it('labels threshold warnings as forecast, displays units/timezone and supports sparse data', () => {
    const weather: WeatherSeries = {
      city: 'Test',
      timeZone: 'Asia/Seoul',
      localDate: '2026-09-09',
      currentTime: '2026-09-09T00:00:00Z',
      temperature: -12,
      code: 73,
      wind: 7,
      hours,
    };
    const html = renderToStaticMarkup(<WeatherCard weather={weather} />);
    expect(html).toContain('−10°C 이하 예보');
    expect(html).toContain('눈 예보');
    expect(html).toContain('Asia/Seoul');
    expect(html).toContain('오늘 시간별 기온 · 강수확률');
    expect(html).toContain('weather-precipitation-bar');
    expect(html).toContain('강수확률 80%');
    expect(renderToStaticMarkup(<WeatherCard weather={{ ...weather, hours: [] }} />)).toContain(
      '충분한 예보가 없습니다',
    );
  });
});
