import type { BrowserWindow, MessageBoxOptions } from 'electron';

export function createBriefingHostConsent(
  getWindow: () => BrowserWindow | undefined,
  show: (window: BrowserWindow, options: MessageBoxOptions) => Promise<{ response: number }>,
) {
  return async (detail: string, signal: AbortSignal) => {
    const window = getWindow();
    if (signal.aborted) throw new Error('source_cancelled');
    if (!window || window.isDestroyed()) throw new Error('briefing_native_consent_unavailable');
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    const result = await show(window, {
      type: 'question',
      title: 'GOSU Briefing',
      message: '이 범위의 Briefing 요청을 허용할까요?',
      detail: detail.slice(0, 3000),
      buttons: ['취소', '이 요청 허용'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      signal,
    });
    if (signal.aborted) throw new Error('source_cancelled');
    if (result.response !== 1) throw new Error('briefing_native_consent_denied');
  };
}
