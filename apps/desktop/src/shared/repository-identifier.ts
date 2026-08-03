const REPOSITORY_IDENTIFIER =
  /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/u;

/**
 * Returns the non-secret repository label that may be shown to an LLM.
 *
 * Workspace records intentionally remain permissive for future connectors, but URLs, SSH
 * locations, tokens, and userinfo must never be copied into an agent prompt or tool result.
 */
export function repositoryIdentifierForAgent(value: string | null | undefined) {
  if (!value) return null;
  const candidate = value.trim();
  return REPOSITORY_IDENTIFIER.test(candidate) ? candidate : null;
}
