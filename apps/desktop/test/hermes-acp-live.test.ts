import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HermesAcpApprovalService } from '../src/main/hermes-acp-approval-service';
import { createNodeHermesAcpProfileFactory } from '../src/main/hermes-acp-profile';
import { HermesAcpProjectChatAdapter } from '../src/main/hermes-acp-project-chat-adapter';
import { HermesProjectChatAdapter } from '../src/main/hermes-project-chat-adapter';

const runRealHermes = process.env.GOSU_RUN_REAL_HERMES_ACP === '1';

async function regularFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await regularFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

describe.skipIf(!runRealHermes)('real BYO Hermes ACP integration', () => {
  const temporaryPaths: string[] = [];
  const adapters: HermesAcpProjectChatAdapter[] = [];

  afterEach(async () => {
    for (const adapter of adapters.splice(0)) adapter.shutdown();
    for (const path of temporaryPaths.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  it(
    'connects the pinned runtime and returns a real fresh-agent result with no native tools or delegation persistence',
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'gosu-real-hermes-acp-cwd-'));
      temporaryPaths.push(cwd);
      const projectId = randomUUID();
      const sessionId = randomUUID();
      const preparedProfileHomes: string[] = [];
      const isolatedProfileScopes = new Map<string, { projectId: string; sessionId: string }>();
      const realProfileFactory = createNodeHermesAcpProfileFactory();
      const approvals = new HermesAcpApprovalService();
      let approvalRequests = 0;
      approvals.on('event', (event) => {
        if (event.type !== 'approval.requested') return;
        approvalRequests += 1;
        approvals.resolve(event.request.id, 'deny');
      });
      const adapter = new HermesAcpProjectChatAdapter({
        runtimeDiscovery: new HermesProjectChatAdapter(),
        approvals,
        clientVersion: () => '0.31.0-live-test',
        profileFactory: {
          prepare(input) {
            const scopeKey = `${input.projectId}:${input.sessionId}`;
            let isolatedScope = isolatedProfileScopes.get(scopeKey);
            if (!isolatedScope) {
              isolatedScope = { projectId: randomUUID(), sessionId: randomUUID() };
              isolatedProfileScopes.set(scopeKey, isolatedScope);
            }
            const profile = realProfileFactory.prepare({
              ...input,
              projectId: isolatedScope.projectId,
              sessionId: isolatedScope.sessionId,
            });
            preparedProfileHomes.push(profile.homeDirectory);
            temporaryPaths.push(profile.homeDirectory);
            return profile;
          },
        },
      });
      adapters.push(adapter);

      const catalogs = await adapter.refreshConnectionCatalogs();
      expect(catalogs.catalog.models[0]?.metadata).toMatchObject({
        agentTools: false,
        delegateTask: false,
      });
      const rawGoalMarker = `GOSU_RAW_DELEGATION_MARKER_${Date.now()}`;
      const result = await adapter.delegate({
        projectId,
        sessionId,
        cwd,
        task: [
          rawGoalMarker,
          'Answer this arithmetic task directly: what is 17 + 25?',
          'Return a concise answer containing 42. Do not invoke or claim any tools.',
        ].join(' '),
      });

      expect(result.reply).toContain('42');
      expect(result.reply).not.toMatch(/delegation[_ -]?id|status.{0,8}dispatched|dispatched/iu);
      expect(result.provenance).toMatchObject({
        providerId: 'hermes',
        transport: 'acp-v1',
        agentVersion: '0.19.1',
      });
      expect(approvalRequests).toBe(0);

      adapter.shutdown();
      expect(preparedProfileHomes.length).toBeGreaterThan(0);
      for (const profileHome of new Set(preparedProfileHomes)) {
        const files = await regularFiles(profileHome);
        const relativeFiles = files.map((path) => relative(profileHome, path));
        for (const path of relativeFiles) {
          expect(path, `unexpected Hermes persistence in ${profileHome}`).not.toMatch(
            /(?:^|\/)(?:state\.db(?:-(?:shm|wal))?|delegation(?:\/|$)|[^/]*subagent[-_]?summary[^/]*)/iu,
          );
        }
        for (const file of files) {
          expect((await readFile(file)).includes(Buffer.from(rawGoalMarker, 'utf8'))).toBe(false);
        }
      }
    },
    5 * 60_000,
  );
});
