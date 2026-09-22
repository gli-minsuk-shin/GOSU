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
