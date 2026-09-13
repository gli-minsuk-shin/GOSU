import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  initialModelPseudocodeRevision,
  serializeModelPseudocodeWorkspace,
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
  type ModelPseudocodeRevision,
} from './src/model-pseudocode';
import { projectModelLabInitialWorkspace } from './src/project-model-workspace';
import { modelPythonArtifactPaths } from './model-copilot-server';
import { isModelPythonArtifactReceipt } from './src/model-python-artifact';
import {
  PROJECT_MODEL_RECEIVED_COPIES_KEY,
  type ProjectModelCopy,
} from './src/project-model-transfer';

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const MAX_COPY_BYTES = 8_000_000;
type Project = { id: string; name: string };

export class ProjectModelTransferStore {
  private readonly tails = new Map<string, Promise<unknown>>();
  constructor(
    private readonly options: {
      root: string;
      readStorage: (id: string) => Promise<Record<string, string>>;
      resolveProject: (id: string) => Promise<Project | null>;
      listProjects: () => Promise<readonly Project[]>;
    },
  ) {}
  async targets(source: string) {
    return (await this.options.listProjects()).filter(
      (project) => project.id !== source && uuid.test(project.id),
    );
  }
  private async locked<T>(target: string, operation: () => Promise<T>) {
    const current = (this.tails.get(target) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.tails.set(target, current);
    return current;
  }
  private path(projectId: string) {
    if (!uuid.test(projectId)) throw new Error('Invalid project');
    return join(this.options.root, projectId, 'model-copies.json');
  }
  private async read(projectId: string): Promise<ProjectModelCopy[]> {
    try {
      const text = await readFile(this.path(projectId), 'utf8');
      if (Buffer.byteLength(text) > MAX_COPY_BYTES) throw new Error('Model copy inbox is full');
      const value = JSON.parse(text);
      if (!Array.isArray(value)) throw new Error('Invalid model copy inbox');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  private async write(projectId: string, copies: readonly ProjectModelCopy[]) {
    const text = JSON.stringify(copies);
    if (Buffer.byteLength(text) > MAX_COPY_BYTES) throw new Error('Model copy inbox is full');
    const path = this.path(projectId);
    await mkdir(join(this.options.root, projectId), { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, text, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  async pending(projectId: string) {
    await this.tails.get(projectId)?.catch(() => undefined);
    return (await this.read(projectId)).filter((copy) => copy.status === 'pending');
  }
  async create(sourceProjectId: string, input: unknown): Promise<ProjectModelCopy> {
    if (!input || typeof input !== 'object') throw new Error('Invalid copy request');
    const { targetProjectId, sourceModelId, sourceRevision, requestId } = input as Record<
      string,
      unknown
    >;
    if (
      typeof targetProjectId !== 'string' ||
      !uuid.test(targetProjectId) ||
      targetProjectId === sourceProjectId ||
      typeof sourceModelId !== 'string' ||
      !sourceModelId ||
      sourceModelId.length > 120 ||
      typeof sourceRevision !== 'number' ||
      !Number.isSafeInteger(sourceRevision) ||
      sourceRevision < 0 ||
      typeof requestId !== 'string' ||
      !uuid.test(requestId)
    )
      throw new Error('Invalid copy request');
    const sourceProject = await this.options.resolveProject(sourceProjectId);
    if (
      !(await this.targets(sourceProjectId)).some((project) => project.id === targetProjectId) ||
      !sourceProject
    )
      throw new Error('Destination project is not available');
    return this.locked(targetProjectId, async () => {
      const copies = await this.read(targetProjectId);
      const existing = copies.find((copy) => copy.id === requestId);
      if (existing) {
        if (
          existing.sourceProjectId !== sourceProjectId ||
          existing.sourceModelId !== sourceModelId ||
          existing.sourceRevision !== sourceRevision
        )
          throw new Error('Copy request ID conflict');
        return existing;
      }
      if (copies.length >= 1000 || copies.filter((copy) => copy.status === 'pending').length >= 64)
        throw new Error('Model copy inbox is full');
      const source = projectModelLabInitialWorkspace(
        (await this.options.readStorage(sourceProjectId))[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY] ??
          null,
      );
      if (source.trashedModelIds.includes(sourceModelId))
        throw new Error('Restore the source model before copying it');
      const root = source.histories[sourceModelId]?.find(
        (revision) => revision.revision === sourceRevision,
      );
      if (!root) throw new Error('Save the selected model revision before copying it');
      const selected = new Map<string, ModelPseudocodeRevision>();
      const visit = (revision: ModelPseudocodeRevision) => {
        if (selected.has(revision.model.id)) return;
        if (selected.size >= 32) throw new Error('Too many nested model dependencies');
        selected.set(revision.model.id, revision);
        for (const module of revision.model.modules)
          if (module.subgraph) {
            const dependency = source.histories[module.subgraph.modelId]?.find(
              (item) => item.revision === source.selectedRevisions[module.subgraph!.modelId],
            );
            if (!dependency) throw new Error('A nested model dependency is missing');
            visit(dependency);
          }
      };
      visit(root);
      const ids = new Map(
        [...selected.keys()].map((id) => [
          id,
          `${id.slice(0, 88)}-copy-${createHash('sha256').update(`${sourceProjectId}:${requestId}:${id}`).digest('hex').slice(0, 16)}`,
        ]),
      );
      const createdAt = new Date().toISOString();
      const entries: ModelPseudocodeRevision[] = [];
      const pythonCopies: Awaited<ReturnType<ProjectModelTransferStore['preparePythonCopy']>>[] =
        [];
      for (const revision of selected.values()) {
        const model = structuredClone(revision.model);
        const copied = {
          ...model,
          id: ids.get(model.id)!,
          name: `${model.name} (copy)`.slice(0, 160),
          sourceLabel:
            `Copied from ${sourceProject.name} r${revision.revision} · ${model.sourceLabel}`.slice(
              0,
              240,
            ),
          modules: model.modules.map((module) =>
            module.subgraph
              ? {
                  ...module,
                  subgraph: { ...module.subgraph, modelId: ids.get(module.subgraph.modelId)! },
                }
              : module,
          ),
        };
        let entry: ModelPseudocodeRevision = {
          ...initialModelPseudocodeRevision(copied, createdAt),
          label: `Copy r${revision.revision} · ${sourceProject.name}`.slice(0, 120),
          ...(revision.originalDraft ? { originalDraft: revision.originalDraft } : {}),
        };
        if (revision.pythonArtifact) {
          const prepared = await this.preparePythonCopy(
            sourceProjectId,
            targetProjectId,
            revision,
            copied.id,
          );
          pythonCopies.push(prepared);
          entry = { ...entry, pythonArtifact: prepared.receipt };
        }
        entries.push(entry);
      }
      const target = projectModelLabInitialWorkspace(
        (await this.options.readStorage(targetProjectId))[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY] ??
          null,
      );
      const candidateHistories = { ...target.histories };
      for (const copy of copies)
        for (const entry of copy.entries ?? []) candidateHistories[entry.model.id] = [entry];
      for (const entry of entries) {
        if (candidateHistories[entry.model.id])
          throw new Error('A destination model already uses this copy identifier');
        candidateHistories[entry.model.id] = [entry];
      }
      if (Object.keys(candidateHistories).length > 64)
        throw new Error('Destination has reached the 64-model workspace limit');
      serializeModelPseudocodeWorkspace({ ...target, histories: candidateHistories });
      const copy: ProjectModelCopy = {
        id: requestId,
        sourceProjectId,
        sourceProjectName: sourceProject.name,
        sourceModelId,
        sourceRevision,
        targetProjectId,
        rootModelId: ids.get(sourceModelId)!,
        modelName: entries[0]!.model.name,
        modelIds: entries.map((entry) => entry.model.id),
        createdAt,
        status: 'pending',
        entries,
      };
      if (Buffer.byteLength(JSON.stringify([...copies, copy])) > MAX_COPY_BYTES)
        throw new Error('Model copy inbox is full');
      if (!(await this.targets(sourceProjectId)).some((project) => project.id === targetProjectId))
        throw new Error('Destination project is no longer available');
      for (const prepared of pythonCopies) {
        await mkdir(prepared.paths.directory, { recursive: true, mode: 0o700 });
        await writeFile(prepared.paths.sourcePath, prepared.bytes, { mode: 0o600 });
        await writeFile(prepared.paths.manifestPath, JSON.stringify(prepared.manifest), {
          mode: 0o600,
        });
      }
      await this.write(targetProjectId, [...copies, copy]);
      return copy;
    });
  }
  async acknowledge(projectId: string, id: string) {
    if (!uuid.test(id)) throw new Error('Invalid model copy ID');
    return this.locked(projectId, async () => {
      const copies = await this.read(projectId);
      const copy = copies.find((item) => item.id === id);
      if (!copy) throw new Error('Model copy not found');
      if (copy.status === 'delivered') return;
      const storage = await this.options.readStorage(projectId);
      const received = JSON.parse(storage[PROJECT_MODEL_RECEIVED_COPIES_KEY] ?? '[]');
      if (!Array.isArray(received) || !received.includes(id))
        throw new Error('Destination has not saved the model copy yet');
      await this.write(
        projectId,
        copies.map((item) => {
          if (item.id !== id) return item;
          const { entries: _entries, ...receipt } = item;
          return { ...receipt, status: 'delivered' };
        }),
      );
    });
  }
  private async preparePythonCopy(
    sourceProjectId: string,
    targetProjectId: string,
    revision: ModelPseudocodeRevision,
    newId: string,
  ) {
    const sourcePaths = modelPythonArtifactPaths(
      join(this.options.root, sourceProjectId, 'artifacts'),
      revision.model.id,
      revision.revision,
    );
    const manifest = JSON.parse(await readFile(sourcePaths.manifestPath, 'utf8'));
    const receipt = manifest.receipt;
    if (
      !isModelPythonArtifactReceipt(receipt) ||
      receipt.modelId !== revision.model.id ||
      receipt.revision !== revision.revision ||
      receipt.sourceSha256 !== revision.pythonArtifact?.sourceSha256
    )
      throw new Error('Source Python artifact receipt is invalid');
    const bytes = await readFile(sourcePaths.sourcePath);
    if (
      bytes.length > 1_000_000 ||
      createHash('sha256').update(bytes).digest('hex') !== receipt.sourceSha256
    )
      throw new Error('Source Python artifact verification failed');
    const paths = modelPythonArtifactPaths(
      join(this.options.root, targetProjectId, 'artifacts'),
      newId,
      0,
    );
    const copied = {
      ...receipt,
      modelId: newId,
      revision: 0,
      absolutePath: paths.sourcePath,
      manifestPath: paths.manifestPath,
    };
    return { receipt: copied, paths, bytes, manifest: { ...manifest, receipt: copied } };
  }
}
