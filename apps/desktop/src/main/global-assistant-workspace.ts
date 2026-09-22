import { z } from 'zod';
import type { AddAssistantLiteratureInput, LiteratureService } from './literature-service';
import type { ResearchNotesService } from './research-notes-service';
import type { ManuscriptWorkspaceService } from './manuscript-workspace-service';
import type { ExperimentWorkspaceService } from './experiment-workspace-service';
import type { AssistantWorkspaceAction } from '../../../briefing-lab/briefing-project-bridge';

/**
 * The global AI assistant's view of one project's research workspace: research notes, the
 * Literature library, captured manuscript checkpoints and experiments. Reads are bounded; writes
 * only add (a new note, library records, an idea, a metric point) and never edit or delete.
 */
type Dependencies = Readonly<{
  notes?: Pick<
    ResearchNotesService,
    'descriptor' | 'listForAgent' | 'readForAgent' | 'saveMarkdownForAgent'
  >;
  literature?: Pick<LiteratureService, 'list' | 'addFromAssistant'>;
  manuscripts?: Pick<
    ManuscriptWorkspaceService,
    'list' | 'listCheckpointFiles' | 'readCheckpointFile'
  >;
  experiments?: Pick<ExperimentWorkspaceService, 'list' | 'createIdea' | 'recordMetric'>;
  now?: () => Date;
}>;

export type GlobalAssistantWorkspace = (
  action: AssistantWorkspaceAction,
  project: Readonly<{ id: string; name: string }>,
  text: string,
  signal: AbortSignal,
  recheck?: () => Promise<void>,
) => Promise<unknown>;

const NOTE_CATEGORIES = [
  'literature',
  'papers',
  'experiments',
  'project-progress',
  'idea-development',
] as const;

const input = <T extends z.ZodRawShape>(shape: T, text: string) => {
  if (text.length > 1_100_000) throw new Error('assistant_workspace_input_invalid');
  const parsed = z
    .object(shape)
    .strict()
    .safeParse(text ? JSON.parse(text) : {});
  if (!parsed.success) throw new Error('assistant_workspace_input_invalid');
  return parsed.data;
};

const clip = (value: string | null | undefined, limit: number) =>
  value ? (value.length > limit ? `${value.slice(0, limit)}…` : value) : null;

export function createGlobalAssistantWorkspace(deps: Dependencies): GlobalAssistantWorkspace {
  return async (action, project, text, signal, recheck) => {
    const check = () => {
      if (signal.aborted) throw new Error('source_cancelled');
    };
    // Writes re-confirm the chat's permissions immediately before they happen.
    const beforeWrite = async () => {
      check();
      await recheck?.();
      check();
    };
    const projectId = project.id;

    if (action === 'notes' || action === 'note-save') {
      if (!deps.notes) throw new Error('assistant_research_notes_unavailable');
      const binding = deps.notes.descriptor(projectId);
      if (!binding) throw new Error('assistant_research_notes_not_connected');
      if (action === 'notes') {
        const request = input(
          {
            query: z.string().max(200).optional(),
            noteId: z
              .string()
              .regex(/^[0-9a-f]{64}$/u)
              .optional(),
            offset: z.number().int().nonnegative().optional(),
          },
          text,
        );
        if (request.noteId) {
          const note = await deps.notes.readForAgent(
            projectId,
            binding.id,
            request.noteId,
            request.offset ?? 0,
          );
          check();
          return { projectId, projectName: project.name, ...note, trust: 'untrusted_note_content' };
        }
        const list = await deps.notes.listForAgent(projectId, binding.id, request.query ?? '', 50);
        check();
        return { projectId, projectName: project.name, ...list };
      }
      const request = input(
        {
          category: z.enum(NOTE_CATEGORIES),
          title: z.string().trim().min(1).max(200),
          content: z.string().min(1).max(1_000_000),
          idempotencyKey: z.string().trim().min(1).max(256),
        },
        text,
      );
      await beforeWrite();
      const receipt = await deps.notes.saveMarkdownForAgent(projectId, binding.id, {
        ...request,
        origin: {
          createdAt: (deps.now?.() ?? new Date()).toISOString(),
          sessionId: null,
          sessionName: null,
          creatorId: 'gosu-ai-assistant',
          creatorName: 'GOSU AI 비서',
        },
      });
      check();
      return {
        saved: true,
        created: receipt.created,
        projectId,
        projectName: project.name,
        category: receipt.category,
        path: receipt.path,
      };
    }

    if (action === 'literature' || action === 'literature-add') {
      if (!deps.literature) throw new Error('assistant_literature_unavailable');
      if (action === 'literature') {
        const request = input({ query: z.string().max(300).optional() }, text);
        const library = await deps.literature.list({ projectId });
        check();
        const terms = (request.query ?? '').toLocaleLowerCase().split(/\s+/u).filter(Boolean);
        const matching = library.records.filter((record) =>
          terms.every((term) =>
            `${record.title} ${record.authors.join(' ')} ${record.doi ?? ''}`
              .toLocaleLowerCase()
              .includes(term),
          ),
        );
        return {
          projectId,
          projectName: project.name,
          total: library.total,
          matching: matching.length,
          records: matching.slice(0, 40).map((record) => ({
            recordId: record.id,
            title: record.title,
            authors: record.authors.slice(0, 6),
            year: record.publishedYear,
            venue: record.containerTitle,
            doi: record.doi,
            sourceUrl: record.sourceUrl,
            reviewStatus: record.reviewStatus,
            manualSummary: clip(record.manualAnnotations.summary, 600),
            aiSummary: clip(record.aiAnnotations?.summary, 600),
          })),
          limited: matching.length > 40,
          note: 'Library metadata and summaries only; no PDFs are stored.',
        };
      }
      const request = input({ papers: z.array(z.unknown()).min(1).max(12) }, text) as Pick<
        AddAssistantLiteratureInput,
        'papers'
      >;
      await beforeWrite();
      const receipt = await deps.literature.addFromAssistant({ projectId, papers: request.papers });
      check();
      return { ...receipt, projectName: project.name, added: receipt.importedCount > 0 };
    }

    if (action === 'manuscripts') {
      if (!deps.manuscripts) throw new Error('assistant_manuscripts_unavailable');
      const request = input(
        {
          manuscriptId: z.string().uuid().optional(),
          checkpointId: z.string().uuid().optional(),
          path: z.string().min(1).max(1_000).optional(),
          offset: z.number().int().nonnegative().optional(),
        },
        text,
      );
      if (request.manuscriptId && request.checkpointId && request.path) {
        const chunk = await deps.manuscripts.readCheckpointFile({
          projectId,
          manuscriptId: request.manuscriptId,
          checkpointId: request.checkpointId,
          relativePath: request.path,
          ...(request.offset ? { offset: request.offset } : {}),
          maxCharacters: 24_000,
        });
        check();
        return {
          projectId,
          manuscriptId: chunk.manuscriptId,
          checkpointId: chunk.checkpointId,
          relativePath: chunk.relativePath,
          offset: chunk.offset,
          nextOffset: chunk.nextOffset,
          truncated: chunk.truncated,
          content: chunk.content,
          trust: 'untrusted_manuscript_content',
        };
      }
      if (request.manuscriptId && request.checkpointId) {
        const list = await deps.manuscripts.listCheckpointFiles({
          projectId,
          manuscriptId: request.manuscriptId,
          checkpointId: request.checkpointId,
        });
        check();
        return {
          projectId,
          manuscriptId: list.manuscriptId,
          checkpointId: list.checkpointId,
          totalFileCount: list.files.length,
          files: list.files.slice(0, 300),
          truncated: list.files.length > 300,
        };
      }
      const snapshot = await deps.manuscripts.list({ projectId });
      check();
      return {
        projectId,
        projectName: project.name,
        manuscripts: snapshot.manuscripts.map(({ manuscript, connection }) => {
          const linked = Boolean(connection?.binding.enabled);
          const checkpoint =
            linked && connection?.lastCheckpoint?.bindingId === connection?.binding.bindingId
              ? connection?.lastCheckpoint
              : null;
          return {
            manuscriptId: manuscript.id,
            title: manuscript.title,
            linked,
            provider: linked ? connection?.providerDisplayName : null,
            checkpointId: checkpoint?.checkpointId ?? null,
            lastObservedAt: linked ? connection?.lastObservedAt : null,
          };
        }),
        note: 'Read-only: the last captured checkpoint, never live Overleaf. GOSU cannot edit manuscripts.',
      };
    }

    if (
      action === 'experiments' ||
      action === 'experiment-idea-add' ||
      action === 'experiment-metric-record'
    ) {
      if (!deps.experiments) throw new Error('assistant_experiments_unavailable');
      if (action === 'experiments') {
        input({}, text);
        const snapshot = await deps.experiments.list({ projectId });
        check();
        const ideas = [...snapshot.ideas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const runs = [...snapshot.runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return {
          projectId,
          projectName: project.name,
          ideas: ideas.slice(0, 60).map((idea) => ({
            ideaId: idea.id,
            parentIdeaId: idea.parentIdeaId,
            title: idea.title,
            hypothesis: clip(idea.hypothesis, 500),
            phase: idea.phase,
            outcome: idea.outcome,
            resultSummary: clip(idea.resultSummary, 500),
            updatedAt: idea.updatedAt,
          })),
          metricPoints: snapshot.metricPoints.slice(-40).map((point) => ({
            ideaId: point.ideaId,
            metric: point.metricDisplayName,
            value: point.value,
            unit: point.unit,
            direction: point.direction,
            source: point.source,
            trialId: point.trialId,
            recordedAt: point.recordedAt,
          })),
          runs: runs.slice(0, 25).map((run) => ({
            runId: run.id,
            ideaId: run.ideaId,
            title: run.title,
            status: run.status,
            mode: run.mode,
            trialId: run.trialId,
            latestMetric: run.latestMetric,
            progressCurrent: run.progressCurrent,
            progressTotal: run.progressTotal,
            updatedAt: run.updatedAt,
            completedAt: run.completedAt,
          })),
          totals: {
            ideas: snapshot.ideas.length,
            metricPoints: snapshot.metricPoints.length,
            runs: snapshot.runs.length,
          },
          note: 'Runs are created and executed only from Project Chat, which holds the SSH approvals.',
        };
      }
      if (action === 'experiment-idea-add') {
        const request = input(
          {
            title: z.string().trim().min(1).max(160),
            hypothesis: z.string().trim().max(4_000).optional(),
            phase: z.string().trim().max(80).optional(),
            parentIdeaId: z.string().uuid().optional(),
          },
          text,
        );
        await beforeWrite();
        const idea = await deps.experiments.createIdea({ projectId, ...request });
        check();
        return {
          added: true,
          projectId,
          projectName: project.name,
          ideaId: idea.id,
          title: idea.title,
          outcome: idea.outcome,
        };
      }
      const request = input(
        {
          ideaId: z.string().uuid(),
          value: z.number().finite(),
          trialId: z.string().trim().min(1).max(128).optional(),
        },
        text,
      );
      await beforeWrite();
      const point = await deps.experiments.recordMetric({ projectId, ...request });
      check();
      return {
        recorded: true,
        projectId,
        projectName: project.name,
        pointId: point.id,
        ideaId: point.ideaId,
        metric: point.metricDisplayName,
        value: point.value,
        unit: point.unit,
        recordedAt: point.recordedAt,
      };
    }
    throw new Error('assistant_workspace_action_invalid');
  };
}
