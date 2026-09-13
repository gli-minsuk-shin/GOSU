import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ModelLabDesktopHost } from '../model-lab-desktop-host';
import { createModelCopilotMiddleware } from '../model-copilot-server';
import { residualClassifier } from '../src/sample-models';
import {
  initialModelPseudocodeWorkspace,
  serializeModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
} from '../src/model-pseudocode';
import { PROJECT_MODEL_SCOPE_KEY } from '../src/project-model-workspace';

// Disposable local UI fixture. No real GOSU project or standalone workspace is read or modified.
const directory = await mkdtemp(join(tmpdir(), 'gosu-project-copy-ui-'));
const projects = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Copy test source' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Copy test destination' },
];
const model = {
  ...residualClassifier,
  id: 'project-copy-ui-fixture',
  name: 'Independent copy verification',
};
await mkdir(join(directory, projects[0]!.id), { recursive: true });
await writeFile(
  join(directory, projects[0]!.id, 'workspace.json'),
  JSON.stringify({
    [PROJECT_MODEL_SCOPE_KEY]: '1',
    [MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY]: serializeModelPseudocodeWorkspace(
      initialModelPseudocodeWorkspace([model]),
    ),
  }),
);
const host = new ModelLabDesktopHost({
  assetsDirectory: resolve('dist'),
  stateDirectory: directory,
  resolveProject: async (id) => projects.find((project) => project.id === id) ?? null,
  listProjects: async () => projects,
  middleware: createModelCopilotMiddleware(),
});
await host.start();
for (const project of projects)
  process.stdout.write(`${project.name}: ${(await host.open(project.id)).url}\n`);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await host.close();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', () => {
  void close();
});
process.on('SIGTERM', () => {
  void close();
});
