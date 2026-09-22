/** Versionless arXiv URLs may resolve to a newer paper and are never offline identity proof. */
export function versionedPaperId(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== 'https://arxiv.org' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return (
      url.pathname.match(
        /^\/(?:abs|html|pdf)\/((?:\d{4}\.\d{4,5}|[a-zA-Z.-]+\/\d{7})v[1-9]\d*)(?:\.pdf)?$/,
      )?.[1] ?? null
    );
  } catch {
    return null;
  }
}

/**
 * The 논문 요약 보관함 record a chat is about, or null. A card in the library builds its chat
 * button with an empty `historyId` and the record's own 64-hex id as the paper id, and
 * `sharedPaperView` publishes the same id; a paper from a briefing's own history carries that
 * briefing's id instead and is not in the library, so it has nowhere to record a conversation.
 */
export function savedLibraryPaperId(
  reference: { historyId: string; paperId: string } | undefined,
): string | null {
  if (!reference) return null;
  const id = reference.historyId.startsWith('shared:')
    ? reference.historyId.slice('shared:'.length)
    : reference.historyId === ''
      ? reference.paperId
      : '';
  return /^[a-f0-9]{64}$/.test(id) ? id : null;
}

/**
 * Which conversation a question about one paper belongs to. 논문 요약 AI is its own chat: its turns
 * are kept under this key, never appended to the AI 비서 transcript, so the assistant's own
 * conversation stays about what the user was discussing with it.
 *
 * The same paper reached from two different briefings is one conversation, because the key is the
 * paper and not the briefing that happened to list it. Only a paper with no usable link at all
 * falls back to the item it was opened from.
 */
export function paperConversationKey(reference: {
  historyId: string;
  paperId: string;
  sourceUrl?: string | undefined;
}): string {
  const saved = savedLibraryPaperId(reference);
  if (saved) return `lib:${saved}`;
  const versioned = versionedPaperId(reference.sourceUrl);
  if (versioned) return `arxiv:${versioned}`;
  const url = stablePaperUrl(reference.sourceUrl);
  if (url) return `url:${url}`;
  return `item:${reference.historyId}\u0000${reference.paperId}`.slice(0, 512);
}

/**
 * A paper link reduced to what identifies the paper: scheme and host lowercased, no credentials, no
 * query, no fragment, no trailing slash. Two links that differ only in those reach one conversation.
 */
function stablePaperUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.host.toLocaleLowerCase()}${path}`.slice(0, 400) || null;
  } catch {
    return null;
  }
}
