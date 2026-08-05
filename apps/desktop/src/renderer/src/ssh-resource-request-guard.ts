import type { SshConnectionProfile } from '../../shared/ssh-contracts';

export type SshResourceRequestToken = Readonly<{
  connectionId: string;
  generation: number;
  profileIdentity: string;
}>;

export function sshResourceProfileIdentity(profile: SshConnectionProfile) {
  return JSON.stringify([profile.version, profile.hostAlias, profile.directTarget ?? null]);
}

export function sshResourceProfilesKey(profiles: readonly SshConnectionProfile[]) {
  return profiles
    .map((profile) => `${profile.id}:${sshResourceProfileIdentity(profile)}`)
    .sort()
    .join(',');
}

export class SshResourceRequestGuard {
  private identities = new Map<string, string>();
  private readonly generations = new Map<string, number>();

  reconcile(profiles: readonly SshConnectionProfile[]) {
    const nextIdentities = new Map(
      profiles.map((profile) => [profile.id, sshResourceProfileIdentity(profile)]),
    );
    const invalidatedIds = new Set<string>();
    for (const [connectionId, identity] of nextIdentities) {
      if (this.identities.get(connectionId) !== identity) invalidatedIds.add(connectionId);
    }
    for (const connectionId of this.identities.keys()) {
      if (!nextIdentities.has(connectionId)) invalidatedIds.add(connectionId);
    }
    for (const connectionId of invalidatedIds) {
      this.generations.set(connectionId, (this.generations.get(connectionId) ?? 0) + 1);
    }
    this.identities = nextIdentities;
    return [...invalidatedIds];
  }

  token(connectionId: string): SshResourceRequestToken | null {
    const profileIdentity = this.identities.get(connectionId);
    if (!profileIdentity) return null;
    return {
      connectionId,
      generation: this.generations.get(connectionId) ?? 0,
      profileIdentity,
    };
  }

  accepts(token: SshResourceRequestToken) {
    return (
      this.generations.get(token.connectionId) === token.generation &&
      this.identities.get(token.connectionId) === token.profileIdentity
    );
  }
}
