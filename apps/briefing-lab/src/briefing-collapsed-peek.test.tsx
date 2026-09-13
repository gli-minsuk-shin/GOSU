import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefingWeatherPeek, BriefingAgendaPeek } from './briefing-collapsed-peek';
import type { WeatherSeries } from './live-types';
const weather: WeatherSeries = {
  city: '서울',
  timeZone: 'Asia/Seoul',
  localDate: '2026-09-10',
  currentTime: '2026-09-10T00:00:00Z',
  temperature: 22.2,
  code: 3,
  wind: 5,
  hours: [
    { time: 1, temperature: 18, apparent: 18, precipitation: 0, code: 3 },
    { time: 2, temperature: 24, apparent: 24, precipitation: 0, code: 3 },
  ],
};
it('keeps condition, temperature and zero rain visible in the collapsed weather header', () => {
  const html = renderToStaticMarkup(<BriefingWeatherPeek weather={weather} />);
  expect(html).toContain('22°C');
  expect(html).toContain('구름');
  expect(html).toContain('18~24°');
  expect(html).toContain('강수 최대 0%');
});
it('does not invent zero temperature or rain when the snapshot is missing', () => {
  expect(renderToStaticMarkup(<BriefingWeatherPeek />)).toContain('저장된 날씨 없음');
  const html = renderToStaticMarkup(
    <BriefingWeatherPeek weather={{ ...weather, temperature: null, hours: [] }} />,
  );
  expect(html).toContain('기온 정보 없음');
  expect(html).not.toContain('0°C');
  expect(html).not.toContain('강수 최대 0%');
});
it('uses the briefing date for today/tomorrow counts and the nearest stored event, not the current day', () => {
  const html = renderToStaticMarkup(
    <BriefingAgendaPeek
      referenceAt="2026-09-10T00:00:00Z"
      timeZone="Asia/Seoul"
      events={[
        {
          title: 'Earlier',
          start: '2026-09-09T23:00:00Z',
          end: '2026-09-09T23:30:00Z',
          timeZone: 'Asia/Seoul',
          allDay: false,
          location: '',
        },
        {
          title: '연구 미팅',
          start: '2026-09-10T04:00:00Z',
          end: '2026-09-10T05:00:00Z',
          timeZone: 'Asia/Seoul',
          allDay: false,
          location: '',
        },
        {
          title: '내일 행사',
          start: '2026-09-11T01:00:00Z',
          end: '2026-09-11T02:00:00Z',
          timeZone: 'Asia/Seoul',
          allDay: false,
          location: '',
        },
      ]}
    />,
  );
  expect(html).toContain('오늘 2개');
  expect(html).toContain('내일 1개');
  expect(html).toContain('연구 미팅');
  expect(html).not.toContain('Earlier');
  expect(html).toContain('오후 1:00');
});
