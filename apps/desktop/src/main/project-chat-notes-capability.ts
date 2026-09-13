import type { LocalNotesVaultGrant } from '../shared/project-chat-contracts';
import type { ProjectAgentVault } from './project-agent-tools';

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 1_500;

/** Resolve an existing grant, never select a vault, grant access, or enumerate/read notes. */
export async function resolveProjectChatNotesGrant(
  vault: ProjectAgentVault | undefined,
  projectId: string,
  savedGrant: LocalNotesVaultGrant | null | undefined,
  options: Readonly<{ timeoutMs?: number }> = {},
): Promise<LocalNotesVaultGrant | null> {
  if (!vault || !savedGrant) return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (
      !/^[a-f0-9]{64}$/u.test(savedGrant.id) ||
      typeof savedGrant.name !== 'string' ||
      !savedGrant.name.trim() ||
      savedGrant.name.length > 256 ||
      (savedGrant.allowAgentMarkdownCreate !== undefined &&
        typeof savedGrant.allowAgentMarkdownCreate !== 'boolean')
    )
      return null;
    // Keep the saved permission exactly; the current descriptor must never widen it.
    const grant: LocalNotesVaultGrant = {
      id: savedGrant.id,
      name: savedGrant.name,
      ...(savedGrant.allowAgentMarkdownCreate === undefined
        ? {}
        : { allowAgentMarkdownCreate: savedGrant.allowAgentMarkdownCreate }),
    };
    const stillBound = () => {
      const descriptor = vault.descriptor(projectId);
      return (
        descriptor?.id === grant.id &&
        descriptor.name === grant.name &&
        savedGrant.id === grant.id &&
        savedGrant.name === grant.name &&
        savedGrant.allowAgentMarkdownCreate === grant.allowAgentMarkdownCreate &&
        vault.matchesGrant(projectId, grant.id)
      );
    };
    if (!stillBound()) return null;
    // Overrides may shorten the preflight, never turn this UI capability check into a long wait.
    const timeoutMs =
      Number.isSafeInteger(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
        ? Math.min(options.timeoutMs!, DEFAULT_PREFLIGHT_TIMEOUT_MS)
        : DEFAULT_PREFLIGHT_TIMEOUT_MS;
    const validated = await Promise.race([
      Promise.resolve()
        .then(() => vault.validateGrant(projectId, grant.id))
        .then(
          () => true,
          () => false,
        ),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    return validated && stillBound() ? grant : null;
  } catch {
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
