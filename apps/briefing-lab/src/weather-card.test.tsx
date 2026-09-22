import { describe, it, expect, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WeatherCard,
  nearestHourIndex,
  weatherCondition,
  weatherPlot,
  precipitationBarHeight,
} from './weather-card';
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
  it('refits the chart when the same hourly series switches between rain and all-zero probability', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: (entries: unknown[]) => void) {}
        observe() {
          this.callback([{ contentRect: { width: 400 } }]);
        }
        disconnect = disconnect;
      },
    );
    let view: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        view = create(<WeatherCard weather={weatherWithRain(Array(24).fill(30))} />, {
          createNodeMock: () => ({}),
        });
      });
      expect(
        view!.root.findAllByType('svg').find((s) => s.props.className === 'weather-chart')?.props
          .viewBox,
      ).toBe('0 0 400 210');
      await act(async () =>
        view!.update(<WeatherCard weather={weatherWithRain(Array(24).fill(0))} />),
      );
      expect(
        view!.root.findAllByType('svg').find((s) => s.props.className === 'weather-chart')?.props
          .viewBox,
      ).toBe('0 0 400 210');
      expect(disconnect).not.toHaveBeenCalled();
    } finally {
      await act(async () => view?.unmount());
      vi.unstubAllGlobals();
    }
  });
  it('shows the hour under the cursor anywhere on the chart, not only on a point', async () => {
    // 2026-09-21: the values appeared only with the cursor exactly on a temperature dot.
    expect(nearestHourIndex([], 10)).toBeNull();
    expect(nearestHourIndex([{ x: 50 }, { x: 100 }, { x: 150 }], 80)).toBe(1);
    expect(nearestHourIndex([{ x: 50 }, { x: 100 }, { x: 150 }], 9_999)).toBe(2);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: (entries: unknown[]) => void) {}
        observe() {
          this.callback([{ contentRect: { width: 400 } }]);
        }
        disconnect() {}
      },
    );
    let view: ReactTestRenderer | undefined;
    try {
      const weather = weatherWithRain(Array(24).fill(40));
      await act(async () => {
        view = create(<WeatherCard weather={weather} />, { createNodeMock: () => ({}) });
      });
      const layer = view!.root.findAll(
        (node) => node.type === 'rect' && node.props.className === 'weather-hit-layer',
      )[0]!;
      expect(layer.props.height).toBe(184);
      const svgBox = { left: 100, width: 800 };
      await act(async () =>
        layer.props.onPointerMove({
          clientX: 100 + 800 * 0.5,
          currentTarget: { ownerSVGElement: { getBoundingClientRect: () => svgBox } },
        }),
      );
      const crosshair = view!.root.findAll(
        (node) => node.type === 'g' && node.props.className === 'weather-crosshair',
      );
      expect(crosshair).toHaveLength(1);
      const label = crosshair[0]!.findByType('text').props.children as string;
      expect(label).toMatch(/^\d{2}시 · 20°C · 강수 40%$/u);
      expect(JSON.stringify(view!.toJSON())).toContain('강수확률 40%');
      await act(async () => layer.props.onPointerLeave());
      expect(
        view!.root.findAll(
          (node) => node.type === 'g' && node.props.className === 'weather-crosshair',
        ),
      ).toHaveLength(0);
    } finally {
      view?.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('keeps the source footer full-width in History as well as Live to avoid a tall empty grid row', () => {
    const css = readFileSync(new URL('./workspace.css', import.meta.url), 'utf8');
    const rule = css
      .split(':is(.briefing-live-view, .briefing-history-run) .weather-source {')[1]!
      .split('}')[0]!;
    expect(rule).toContain('grid-column: 1/-1');
    expect(rule).toContain('grid-row: 5');
  });
  it('labels positive probabilities and isolated zeros without treating missing values as zero', () => {
    const html = renderToStaticMarkup(
      <WeatherCard weather={weatherWithRain([0, 50, null, 0, 1])} />,
    );
    expect(html.match(/class="weather-precipitation-bar/g)).toHaveLength(4);
    expect(html.match(/data-probability="0"/g)).toHaveLength(2);
    expect(html.match(/>0%<\/text>/g)).toHaveLength(1);
    const bars = html.match(/<rect class="weather-precipitation-bar[^>]+>/g)!;
    expect(bars[0]).toContain('y="184"');
    expect(bars[0]).toContain('height="2"');
    expect(bars[1]).toContain('height="32"');
    expect(bars[3]).toContain('height="0.64"');
    expect(html).toContain('>50%</text>');
    expect(html).not.toContain('>1%</text>');
    expect(html).not.toContain('weather-probability-label');
    expect(html).toContain('강수확률 0%');
    expect(html).toContain('viewBox="0 0 340 210"');
  });
  it('compacts dry historical windows while preserving all hourly markers and positive DST labels', () => {
    const weather = weatherWithRain(Array(24).fill(0));
    const html = renderToStaticMarkup(<WeatherCard weather={weather} historical />);
    expect(html.match(/data-probability="0"/g)).toHaveLength(24);
    expect(html).toContain('당시 예보');
    expect(html).toContain('예보 구간 강수확률 0%');
    expect(html).not.toContain('class="weather-probability-label');
    expect(html).toContain('min-width:340px');
    expect(html).toContain('viewBox="0 0 340 210"');
    expect(html).not.toContain('y="130"');
    expect(html).toContain('weather-chart-scroll');
    const dst = renderToStaticMarkup(
      <WeatherCard weather={weatherWithRain(Array(25).fill(100))} />,
    );
    expect(dst.match(/>100%<\/text>/g)).toHaveLength(1);
    expect(dst).toContain('min-width:340px');
    expect(
      renderToStaticMarkup(<WeatherCard weather={weatherWithRain([null, null, null])} />),
    ).not.toContain('weather-precipitation-bar');
  });
  it('uses only three fixed axis labels even when all probability values are missing', () => {
    const unknown = renderToStaticMarkup(
      <WeatherCard weather={weatherWithRain(Array(24).fill(null))} />,
    );
    expect(unknown).toContain('강수확률 미제공');
    expect(unknown).not.toContain('예보 구간 강수확률 0%');
    expect(unknown.match(/class="weather-probability-axis/g)).toHaveLength(3);
    expect(unknown.match(/>\d+%<\/text>/g)).toEqual(['>0%</text>', '>50%</text>', '>100%</text>']);
  });
  it('keeps the positive scale proportional above its disclosed minimum and never invents zero/missing rain', () => {
    expect(precipitationBarHeight(100)).toBe(64);
    expect(precipitationBarHeight(50)).toBe(32);
    expect(precipitationBarHeight(10)).toBe(6.4);
    expect(precipitationBarHeight(1)).toBe(0.64);
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
