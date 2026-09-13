import { useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { LiveSourceSettings } from './live-source-settings';
import { initialWorkspace } from './fixtures';
import { sourceRequest } from './live-client';
import { defaultAssistantPreferences, defaultLiveSettings } from '@gosu/briefing-core';
import { MailConnectionSettings } from './mail-connection-settings';
vi.mock('./live-client', () => ({ sourceRequest: vi.fn() }));
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('removing the last account disables Mail reading without revoking Calendar or historical private-AI preferences', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(sourceRequest).mockResolvedValue({
    state: 'configured',
    expiresAt: null,
    approved: true,
  });
  const routine = {
    ...initialWorkspace().routines[0]!,
    live: {
      ...defaultLiveSettings(),
      assistant: {
        ...defaultAssistantPreferences(),
        mailRead: true,
        mailAi: true,
        calendarRead: true,
        calendarIds: ['cal'],
      },
    },
  };
  const changed = vi.fn();
  await act(() => {
    renderer = create(<LiveSourceSettings routine={routine} onChange={changed} />);
  });
  await act(() => renderer!.root.findByType(MailConnectionSettings).props.onChange(null));
  expect(changed.mock.calls[0]?.[0]).toMatchObject({
    mail: null,
    assistant: { mailRead: false, mailAi: true, calendarRead: true, calendarIds: ['cal'] },
  });
});
it('defaults Scholar alert inclusion on without changing Mail or AI permissions and allows opting out', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const routine = initialWorkspace().routines[0]!;
  const onChange = vi.fn();
  await act(() => {
    renderer = create(<LiveSourceSettings routine={routine} onChange={onChange} />);
  });
  const label = renderer!.root
    .findAllByType('label')
    .find((n) =>
      n.children.some((c) => typeof c === 'string' && c.includes('Google Scholar 알림 메일')),
    )!;
  expect(label.findByType('input').props.checked).toBe(true);
  await act(() => label.findByType('input').props.onChange({ target: { checked: false } }));
  expect(onChange.mock.calls[0]?.[0].papers.scholarAlerts).toBe(false);
  expect(sourceRequest).not.toHaveBeenCalled();
});
it('chooses a real city into the routine draft and gates mail authorization behind explicit consent', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let current = initialWorkspace().routines[0]!;
  function Harness() {
    const [routine, setRoutine] = useState(current);
    return (
      <LiveSourceSettings
        routine={routine}
        onChange={(live) => {
          current = { ...routine, live };
          setRoutine(current);
        }}
      />
    );
  }
  await act(() => {
    renderer = create(<Harness />);
  });
  expect(sourceRequest).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer!.toJSON())).toContain('LLM/CLI의 대화·로그 보관 정책');
  const field = (name: string) =>
    renderer!.root
      .findAllByType('label')
      .find((label) => label.findAllByType('span')[0]?.children.join('') === name)!;
  const button = (name: string) =>
    renderer!.root.findAllByType('button').find((b) => b.children.join('') === name)!;
  const city = {
    id: 123,
    name: 'Chosen city',
    latitude: 37,
    longitude: 127,
    country: 'KR',
    timeZone: 'Asia/Seoul',
  };
  vi.mocked(sourceRequest).mockResolvedValueOnce({ cities: [city] });
  await act(() =>
    field('날씨 도시 검색')
      .findByType('input')
      .props.onChange({ target: { value: 'Chosen' } }),
  );
  await act(() => button('도시 찾기').props.onClick());
  await act(() =>
    field('날씨 도시 선택')
      .findByType('select')
      .props.onChange({ target: { value: '123' } }),
  );
  expect(current.live?.weather).toEqual(city);
  expect(button('이 조건으로 메일 읽기 연결')).toBeUndefined();
  expect(vi.mocked(sourceRequest).mock.calls.some(([path]) => path.includes('authorize'))).toBe(
    false,
  );
});
