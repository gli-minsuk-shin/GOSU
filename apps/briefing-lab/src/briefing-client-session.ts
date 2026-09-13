let clientToken = '';
const KEY = 'gosu.briefing.client-capability.v1';
export async function briefingHeaders(signal: AbortSignal) {
  if (!clientToken) {
    try {
      clientToken = localStorage.getItem(KEY) ?? '';
    } catch {
      /* per-page fallback */
    }
    if (!/^[a-f0-9]{64}$/.test(clientToken)) {
      clientToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      try {
        localStorage.setItem(KEY, clientToken);
      } catch {
        /* Per-page capability stays stable. */
      }
    }
  }
  const response = await fetch('/api/briefing-agent/session', {
    signal,
    cache: 'no-store',
    headers: clientToken ? { 'X-Gosu-Client-Token': clientToken } : {},
  });
  if (!response.ok) throw new Error('Briefing backend에 연결하지 못했습니다.');
  const session = (await response.json()) as { token: string; clientToken?: string };
  if (session.clientToken) {
    clientToken = session.clientToken;
    try {
      localStorage.setItem(KEY, clientToken);
    } catch {
      /* remain scoped to this page */
    }
  }
  return {
    'Content-Type': 'application/json',
    'X-Gosu-Routine-Token': session.token,
    ...(clientToken ? { 'X-Gosu-Client-Token': clientToken } : {}),
  };
}
