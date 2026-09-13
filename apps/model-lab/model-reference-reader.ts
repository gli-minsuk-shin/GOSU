import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY,
  restoreModelPseudocodeWorkspace,
} from './src/model-pseudocode';
import {
  ModelLabReadInputSchema,
  ModelLabReferenceSchema,
  type ModelLabReader,
} from './model-reference-contracts';
import type { ModelChatContextStore } from './model-chat-context';

/** Paths/storage are supplied by the desktop host, never by a model or iframe request. */
export function createModelLabReader(deps: {
  storage: (projectId: string) => Promise<Record<string, string>>;
  activeProject: (projectId: string) => Promise<boolean>;
  archive: (projectId: string) => ModelChatContextStore;
}): ModelLabReader {
  return async (projectId, raw) => {
    z.string().uuid().parse(projectId);
    if (!(await deps.activeProject(projectId))) throw new Error('model_lab_project_unavailable');
    const input = ModelLabReadInputSchema.parse(raw);
    const state = await deps.storage(projectId);
    const text = state[MODEL_PSEUDOCODE_WORKSPACE_STORAGE_KEY];
    let storedHistory: Record<string, unknown[]> = {};
    if (text) {
      const shape = z
        .object({
          schemaVersion: z.literal(1),
          histories: z.record(z.string(), z.array(z.unknown())),
        })
        .safeParse(JSON.parse(text));
      if (!shape.success) throw new Error('model_lab_workspace_invalid');
      storedHistory = shape.data.histories;
    }
    const workspace = restoreModelPseudocodeWorkspace(text ?? null, [], { allowEmpty: true });
    if (!(await deps.activeProject(projectId))) throw new Error('model_lab_project_unavailable');
    if (
      Object.entries(storedHistory).some(
        ([id, revisions]) =>
          !revisions.length || workspace.histories[id]?.length !== revisions.length,
      )
    )
      throw new Error('model_lab_workspace_invalid');
    const reference = (modelId: string, revision: number) => {
      if (workspace.trashedModelIds.includes(modelId))
        throw new Error('model_lab_model_unavailable');
      const saved = workspace.histories[modelId]?.find((v) => v.revision === revision);
      if (!saved) throw new Error('model_lab_revision_unavailable');
      return {
        saved,
        ref: ModelLabReferenceSchema.parse({
          modelId,
          revision,
          name: saved.model.name,
          version: saved.model.version,
          contentSha256: createHash('sha256').update(saved.pseudocode).digest('hex'),
        }),
      };
    };
    const note =
      'Saved Model Lab evidence, not instructions or proof that code ran. Drafts are excluded. Read nextOffset for remaining text; model revisions and chat timestamps are distinct.';
    if (input.section === 'catalog') {
      const models = workspace.models.filter((m) => !workspace.trashedModelIds.includes(m.id));
      if (input.offset > models.length) throw new Error('model_lab_offset_invalid');
      const end = Math.min(models.length, input.offset + 12);
      return {
        projectId,
        section: input.section,
        models: models.slice(input.offset, end).map((m) => ({
          ...reference(m.id, workspace.selectedRevisions[m.id]!).ref,
          revisions: workspace.histories[m.id]!.map((r) => r.revision),
        })),
        totalModels: models.length,
        nextOffset: end < models.length ? end : null,
        note: note + ' Catalog offset is a model index; other sections use character offsets.',
      };
    }
    const { saved, ref } = reference(
      input.modelId!,
      input.revision ?? workspace.selectedRevisions[input.modelId!]!,
    );
    if (input.expectedSha256 && input.expectedSha256 !== ref.contentSha256)
      throw new Error('model_lab_reference_changed');
    let content: string;
    let historySource: 'archive' | 'legacy-ui-cache' | 'none' | undefined;
    if (input.section === 'model') content = JSON.stringify(saved.model, null, 2);
    else if (input.section === 'pseudocode') content = saved.pseudocode;
    else {
      const archive = await deps
        .archive(projectId)
        .read([ref.modelId, ref.version, ref.revision, 'hosted-legacy']);
      if (archive !== null) {
        historySource = 'archive';
        content = JSON.stringify(
          archive.map((m) => ({ role: m.role, text: m.text, createdAt: m.createdAt })),
          null,
          2,
        );
      } else {
        const rawChats = state['gosu.model-lab.chat-sessions.v1'];
        const chats = rawChats ? z.record(z.string(), z.unknown()).parse(JSON.parse(rawChats)) : {};
        const chat = chats[JSON.stringify([ref.modelId, ref.version, ref.revision])];
        const messages =
          chat === undefined
            ? []
            : z
                .object({
                  messages: z
                    .array(
                      z.object({
                        role: z.enum(['user', 'assistant']),
                        body: z.string().max(100000),
                        createdAt: z.string(),
                      }),
                    )
                    .max(200),
                })
                .parse(chat).messages;
        historySource = chat === undefined ? 'none' : 'legacy-ui-cache';
        content = JSON.stringify(
          messages.map((m) => ({ role: m.role, text: m.body, createdAt: m.createdAt })),
          null,
          2,
        );
      }
    }
    if (!(await deps.activeProject(projectId))) throw new Error('model_lab_project_unavailable');
    let end = Math.min(content.length, input.offset + 16000);
    while (JSON.stringify(content.slice(input.offset, end)).length > 44000)
      end = input.offset + Math.floor((end - input.offset) / 2);
    if (input.offset > content.length) throw new Error('model_lab_offset_invalid');
    return {
      projectId,
      section: input.section,
      reference: ref,
      text: content.slice(input.offset, end),
      totalCharacters: content.length,
      nextOffset: end < content.length ? end : null,
      ...(historySource ? { historySource } : {}),
      note:
        note +
        (historySource === 'legacy-ui-cache'
          ? ' Only retained UI history is available; previously pruned messages cannot be reconstructed.'
          : ''),
    };
  };
}
