import { z } from 'zod';
import {
  ModelLabReadInputSchema,
  type ModelLabReader,
} from '../../../model-lab/model-reference-contracts';
import { redactAgentMemoryText } from '@gosu/contracts';
import type { ProjectBridge } from '../../../briefing-lab/briefing-project-bridge';
import { modelLabWriteFailure, type ModelLabWriter } from '../../../model-lab/model-lab-chat-write';
import type { GlobalAssistantWorkspace } from './global-assistant-workspace';

const WORKSPACE_ACTIONS = new Set([
  'notes',
  'note-save',
  'literature',
  'literature-add',
  'manuscripts',
  'experiments',
  'experiment-idea-add',
  'experiment-metric-record',
]);
type Project = {
  id: string;
  name: string;
  archivedAt?: string | undefined;
  trashedAt?: string | undefined;
};
type Dependencies = {
  modelLab?: ModelLabReader;
  /** Adds a chat-written model to one project's Model Lab through its adoption inbox. */
  modelLabWrite?: ModelLabWriter;
  /** Research notes, Literature, manuscripts and experiments of one active project. */
  workspace?: GlobalAssistantWorkspace;
  projects: () => Promise<readonly Project[]>;
  sessions: (projectId: string) => Promise<{ id: string; title: string; updatedAt: string }[]>;
  read: (
    projectId: string,
    sessionId: string,
  ) => Promise<{
    messages: { role: string; content: string; createdAt: string }[];
    activeTurnId?: string | undefined;
  }>;
  memory: (projectId: string) => unknown;
  remember: (projectId: string, text: string) => boolean;
  send: (projectId: string, sessionId: string | undefined, message: string) => Promise<unknown>;
  confirm: (message: string, signal: AbortSignal) => Promise<void>;
};
export function createGlobalAssistantProjects(deps: Dependencies): ProjectBridge {
  const active = async () => (await deps.projects()).filter((p) => !p.archivedAt && !p.trashedAt);
  return async (action, projectId, text, signal, recheck) => {
    const check = () => {
      if (signal.aborted) throw new Error('source_cancelled');
    };
    check();
    const projects = await active();
    check();
    if (action === 'list')
      return {
        projects: projects.slice(0, 100).map(({ id, name }) => ({ id, name })),
        limited: projects.length > 100,
      };
    z.string().uuid().parse(projectId);
    const project = projects.find((p) => p.id === projectId);
    if (!project) throw new Error('assistant_project_unavailable');
    if (WORKSPACE_ACTIONS.has(action)) {
      if (!deps.workspace) throw new Error('assistant_workspace_unavailable');
      const result = await deps.workspace(
        action as Parameters<GlobalAssistantWorkspace>[0],
        { id: project.id, name: project.name },
        text,
        signal,
        recheck,
      );
      check();
      if (!(await active()).some((p) => p.id === projectId))
        throw new Error('assistant_project_unavailable');
      return result;
    }
    if (action === 'model-lab-add') {
      if (!deps.modelLabWrite) throw new Error('assistant_model_lab_unavailable');
      const input = z
        .object({
          requestId: z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/),
          pseudocode: z.string().min(1).max(300000),
        })
        .strict()
        .parse(JSON.parse(text));
      await recheck?.();
      check();
      try {
        const receipt = await deps.modelLabWrite(projectId, input);
        check();
        return {
          ...receipt,
          projectId,
          projectName: project.name,
          added: receipt.status === 'added',
        };
      } catch (error) {
        const failed = modelLabWriteFailure(error);
        // The parser reason goes back to the assistant so it can correct the pseudocode.
        if (failed.reason) return { added: false, projectId, ...failed };
        throw new Error(failed.error, { cause: error });
      }
    }
    if (action === 'model-lab') {
      if (!deps.modelLab) throw new Error('assistant_model_lab_unavailable');
      if (text.length > 2000) throw new Error('assistant_model_lab_input_invalid');
      const input = ModelLabReadInputSchema.parse(text ? JSON.parse(text) : {});
      const result = await deps.modelLab(projectId, input);
      check();
      if (!(await active()).some((p) => p.id === projectId))
        throw new Error('assistant_project_unavailable');
      await recheck?.();
      check();
      return result;
    }
    const sessions = (await deps.sessions(projectId)).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    check();
    if (action === 'read') {
      const selected = text ? sessions.filter((s) => s.id === text) : sessions.slice(0, 3);
      if (text && !selected.length) throw new Error('assistant_project_session_unavailable');
      const recent = [];
      for (const session of selected) {
        const state = await deps.read(projectId, session.id);
        check();
        recent.push({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          running: Boolean(state.activeTurnId),
          messages: state.messages.slice(-6).map((m) => ({
            role: m.role,
            text: redactAgentMemoryText(m.content).slice(0, 1800),
            createdAt: m.createdAt,
          })),
        });
      }
      return {
        project: { id: project.id, name: project.name },
        modelLabAvailable: Boolean(deps.modelLab),
        sessions: recent,
        sessionCatalog: sessions
          .slice(0, 100)
          .map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
        limited: sessions.length > 3,
        memory: deps.memory(projectId),
        note: 'Bounded historical context; not a guarantee of current execution success.',
      };
    }
    const note = z.string().trim().min(1).max(3000).parse(text);
    await deps.confirm(
      `${project.name}\n\n${action === 'remember' ? '이 프로젝트의 AI 기억에 공유합니다.' : '이 프로젝트 채팅에 작업을 요청합니다. 실행에는 해당 프로젝트의 권한과 사용량이 적용됩니다.'}\n\n${note}`,
      signal,
    );
    check();
    if (!(await active()).some((p) => p.id === projectId))
      throw new Error('assistant_project_unavailable');
    await recheck?.();
    check();
    if (action === 'remember') return { saved: deps.remember(projectId, note), projectId };
    const receipt = await deps.send(
      projectId,
      sessions[0]?.id,
      `[전역 AI 비서에서 승인한 프로젝트 요청]\n${note}`,
    );
    return {
      submitted: true,
      projectId,
      receipt,
      note: 'Submission only. Read project again for completion; never retry an uncertain submission automatically.',
    };
  };
}
