import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelLabDesktopHost } from './model-lab-desktop-host';
import { modelLabBackendContext, modelLabBackendDirectory } from './model-lab-backend-context';
import { bottleneckAutoencoder, residualClassifier } from './src/sample-models';
import { projectModelLabInitialWorkspace } from './src/project-model-workspace';
import {
  initialModelPseudocodeWorkspace,
  modelToPseudocode,
  serializeModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
} from './src/model-pseudocode';
import { PROJECT_MODEL_RECEIVED_COPIES_KEY } from './src/project-model-transfer';
import { randomUUID } from 'node:crypto';

const projectA = '11111111-1111-4111-8111-111111111111';
const projectB = '22222222-2222-4222-8222-222222222222';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gosu-model-lab-host-test-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const assets = join(root, 'ui');
  await mkdir(assets);
  await writeFile(join(assets, 'index.html'), '<html><head></head><body>Model Lab</body></html>');
  const projects = new Map([
    [projectA, { id: projectA, name: 'Alpha </script>' }],
    [projectB, { id: projectB, name: 'Beta' }],
  ]);
  const host = new ModelLabDesktopHost({
    assetsDirectory: assets,
    stateDirectory: join(root, 'projects'),
    resolveProject: async (id) => projects.get(id) ?? null,
    listProjects: async () => [...projects.values()],
    middleware: async (_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          projectId: modelLabBackendContext.getStore()?.projectId,
          artifacts: modelLabBackendDirectory('artifacts'),
        }),
      );
    },
  });
  cleanups.push(() => host.close());
  await host.start();
  return { root, host, projects, assets };
}
describe('bundled project Model Lab host', () => {
  it('exposes a saved model to chat without a capability URL, creating an archive or mixing project storage', async () => {
    const { host, root, projects } = await fixture();
    const location = await host.open(projectA);
    const model = { ...residualClassifier, id: 'model-reference-fixture' };
    await fetch(`${location.url}api/model-lab-storage`, {
      method: 'PUT',
      body: JSON.stringify({
        key: MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
        value: serializeModelPseudocodeWorkspace(initialModelPseudocodeWorkspace([model])),
      }),
    });
    const before = await readFile(join(root, 'projects', projectA, 'workspace.json'), 'utf8');
    const catalog = await host.readForChat(projectA, {});
    expect(catalog.models?.map((r) => r.modelId)).toEqual([model.id]);
    expect((await host.readForChat(projectB, {})).models).toEqual([]);
    expect(
      (await host.readForChat(projectA, { section: 'conversation', modelId: model.id }))
        .historySource,
    ).toBe('none');
    expect(await readFile(join(root, 'projects', projectA, 'workspace.json'), 'utf8')).toBe(before);
    projects.delete(projectA);
    await expect(host.readForChat(projectA, {})).rejects.toThrow('project_unavailable');
  });
  it('persists one default autoencoder independently for each newly opened project', async () => {
    const { host, root } = await fixture();
    const a = await host.open(projectA);
    const b = await host.open(projectB);
    await Promise.all([fetch(a.url), fetch(b.url)]);
    for (const id of [projectA, projectB]) {
      const storage = JSON.parse(
        await readFile(join(root, 'projects', id, 'workspace.json'), 'utf8'),
      );
      const workspace = projectModelLabInitialWorkspace(
        storage[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY],
      );
      expect(workspace.models.map((model) => model.id)).toEqual([bottleneckAutoencoder.id]);
      expect(workspace.trashedModelIds).toEqual([]);
    }
  });
  it('routes copies through the authenticated source project and a separate destination inbox', async () => {
    const { host } = await fixture();
    const a = await host.open(projectA);
    const b = await host.open(projectB);
    const model = { ...residualClassifier, id: 'host-owned-model' };
    await fetch(`${a.url}api/model-lab-storage`, {
      method: 'PUT',
      body: JSON.stringify({
        key: MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
        value: serializeModelPseudocodeWorkspace(initialModelPseudocodeWorkspace([model])),
      }),
    });
    const targets = await (await fetch(`${a.url}api/model-lab-project-copies/targets`)).json();
    expect(targets.projects.map((project: { id: string }) => project.id)).toEqual([projectB]);
    const response = await fetch(`${a.url}api/model-lab-project-copies`, {
      method: 'POST',
      body: JSON.stringify({
        targetProjectId: projectB,
        sourceModelId: model.id,
        sourceRevision: 0,
        requestId: randomUUID(),
        sourceProjectId: projectB,
      }),
    });
    expect(response.status).toBe(200);
    const { copy } = await response.json();
    expect(copy.sourceProjectId).toBe(projectA);
    expect(
      (await (await fetch(`${b.url}api/model-lab-project-copies`)).json()).copies,
    ).toHaveLength(1);
    expect(
      (await (await fetch(`${a.url}api/model-lab-project-copies`)).json()).copies,
    ).toHaveLength(0);
    expect(
      (
        await fetch(`${a.url}api/model-lab-project-copies/ack`, {
          method: 'POST',
          body: JSON.stringify({ id: copy.id }),
        })
      ).status,
    ).toBe(400);
  });
  it('serves shared UI with escaped project bootstrap and stable per-project capabilities', async () => {
    const { host } = await fixture();
    const a = await host.open(projectA);
    const b = await host.open(projectB);
    expect(await host.open(projectA)).toEqual(a);
    expect(b.url).not.toBe(a.url);
    const response = await fetch(a.url);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('gosu-model-lab-host');
    expect(html).toContain('Alpha \\u003c/script>');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('isolates project files, durable chat/memory state and revision keys across projects', async () => {
    const { host, root } = await fixture();
    const a = await host.open(projectA);
    const b = await host.open(projectB);
    const save = await fetch(`${a.url}api/model-lab-storage`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'gosu.model-lab.chat-sessions.v1', value: '한글 draft A' }),
    });
    expect(save.status).toBe(204);
    expect(await (await fetch(a.url)).text()).toContain('한글 draft A');
    expect(await (await fetch(b.url)).text()).not.toContain('한글 draft A');
    const scopeA = await (await fetch(`${a.url}api/test`)).json();
    const scopeB = await (await fetch(`${b.url}api/test`)).json();
    expect(scopeA.artifacts).toBe(join(root, 'projects', projectA, 'artifacts'));
    expect(scopeB.artifacts).toBe(join(root, 'projects', projectB, 'artifacts'));
    expect(await readFile(join(root, 'projects', projectA, 'workspace.json'), 'utf8')).toContain(
      '한글 draft A',
    );
  });
  it('rejects missing capabilities, cross-project token reuse, foreign origins, paths and removed projects', async () => {
    const { host, projects } = await fixture();
    const a = await host.open(projectA);
    await host.open(projectB);
    expect((await fetch(`${host.origin}/api/test`)).status).toBe(403);
    expect((await fetch(a.url.replace(projectA, projectB))).status).toBe(403);
    expect(
      (await fetch(`${a.url}api/test`, { headers: { origin: 'https://evil.example' } })).status,
    ).toBe(403);
    expect((await fetch(`${a.url}%2fetc%2fpasswd`)).status).toBe(403);
    expect(
      (
        await fetch(`${a.url}api/model-lab-storage`, {
          method: 'PUT',
          body: JSON.stringify({ key: '../../other', value: 'bad' }),
        })
      ).status,
    ).toBe(400);
    projects.delete(projectA);
    expect((await fetch(a.url)).status).toBe(404);
    await expect(host.open('../escape')).rejects.toThrow();
  });
  it('serializes writes so concurrent workspace and chat saves cannot overwrite each other', async () => {
    const { host } = await fixture();
    const a = await host.open(projectA);
    await Promise.all(
      ['workspace', 'chat', 'memory'].map((key) =>
        fetch(`${a.url}api/model-lab-storage`, {
          method: 'PUT',
          body: JSON.stringify({ key: `gosu.model-lab.${key}`, value: key }),
        }),
      ),
    );
    const html = await (await fetch(a.url)).text();
    for (const key of ['workspace', 'chat', 'memory'])
      expect(html).toContain(`gosu.model-lab.${key}`);
  });
  it('adds a chat model to a project: added once an open Model Lab adopts it, queued otherwise', async () => {
    const { host } = await fixture();
    const location = await host.open(projectA);
    const pseudocode = modelToPseudocode({ ...residualClassifier, id: 'chat-model' });
    const pending = host.addModelForChat(
      projectA,
      { requestId: randomUUID(), pseudocode, origin: 'project-chat' },
      { waitMs: 3000, pollMs: 20 },
    );
    // What an open Model Lab does: read the inbox, save the model with its receipt, acknowledge.
    let copies: { id: string }[] = [];
    for (let i = 0; i < 50 && !copies.length; i++) {
      copies = (await (await fetch(`${location.url}api/model-lab-project-copies`)).json()).copies;
      if (!copies.length) await new Promise((r) => setTimeout(r, 10));
    }
    await fetch(`${location.url}api/model-lab-storage`, {
      method: 'PUT',
      body: JSON.stringify({
        key: PROJECT_MODEL_RECEIVED_COPIES_KEY,
        value: JSON.stringify([copies[0]!.id]),
      }),
    });
    await fetch(`${location.url}api/model-lab-project-copies/ack`, {
      method: 'POST',
      body: JSON.stringify({ id: copies[0]!.id }),
    });
    expect(await pending).toMatchObject({ modelId: 'chat-model', status: 'added' });
    // With no Model Lab open it is reported as waiting, not as added.
    const queued = await host.addModelForChat(
      projectB,
      { requestId: randomUUID(), pseudocode, origin: 'ai-assistant' },
      { waitMs: 0 },
    );
    expect(queued.status).toBe('queued');
  });
});
