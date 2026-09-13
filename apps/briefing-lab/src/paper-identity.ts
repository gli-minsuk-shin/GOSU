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
