import { isGosuEmbedded } from './desktop-bridge';
/** File payload stays inside the app-owned frame/main-renderer bridge; no client token or raw path crosses it. */
export function reserveBriefingFileDrop(
  routineId: string,
  files: readonly File[],
): Promise<string> {
  if (!isGosuEmbedded())
    return Promise.reject(new Error('파일 드래그 첨부는 GOSU 앱에서 사용할 수 있습니다.'));
  if (!files.length || files.length > 5)
    return Promise.reject(new Error('첨부는 최대 5개까지 가능합니다.'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('파일 첨부 연결이 응답하지 않습니다. 다시 놓아주세요.'));
    }, 10000);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        !(
          event.origin === 'null' || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(event.origin)
        ) ||
        event.data?.type !== 'gosu-briefing-file-drop-result' ||
        event.data.requestId !== requestId
      )
        return;
      cleanup();
      if (typeof event.data.ticket === 'string' && /^[a-f0-9-]{36}$/.test(event.data.ticket))
        resolve(event.data.ticket);
      else reject(new Error('파일을 첨부하지 못했습니다. 로컬 문서·이미지 파일인지 확인해주세요.'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
    window.addEventListener('message', receive);
    window.parent.postMessage(
      { type: 'gosu-briefing-file-drop', requestId, routineId, files },
      '*',
    );
  });
}
