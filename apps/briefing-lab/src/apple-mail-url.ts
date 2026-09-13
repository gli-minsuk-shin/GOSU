/** Mail's original-message scheme, not mailto (which composes a new message). */
export function appleMailMessageUrl(raw: string | undefined): string | undefined {
  if (!raw || raw.length > 998) return undefined;
  const id = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
  if (!/^[\x21-\x7e]+$/.test(id) || /[<>]/.test(id) || !/^[^@]+@[^@]+$/.test(id)) return undefined;
  return `message://${encodeURIComponent(`<${id}>`)}`;
}
export function safeAppleMailUrl(value: string | undefined): string | undefined {
  if (!value?.startsWith('message://') || value.length > 3200) return undefined;
  try {
    const canonical = appleMailMessageUrl(decodeURIComponent(value.slice('message://'.length)));
    return canonical === value ? canonical : undefined;
  } catch {
    return undefined;
  }
}
