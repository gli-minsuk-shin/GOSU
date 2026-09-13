import {
  generateFixtureRun,
  parseBriefingWorkspace,
  type BriefingWorkspace,
} from '@gosu/briefing-core';
import { fixtureEvidence } from './fixtures';
import { initialRealWorkspace, withoutSampleContent } from './workspace-defaults';

export const BRIEFING_STORAGE_KEY = 'gosu.briefing-lab.workspace.v2';
export const LEGACY_BRIEFING_STORAGE_KEY = 'gosu.briefing-lab.fixture-workspace.v1';
export const MAX_SAVED_RUNS = 100;
export function loadWorkspace(
  storage: Pick<Storage, 'getItem'>,
  now: string,
): { workspace: BriefingWorkspace; error: string | null; writable: boolean } {
  try {
    const raw =
      storage.getItem(BRIEFING_STORAGE_KEY) ?? storage.getItem(LEGACY_BRIEFING_STORAGE_KEY);
    if (raw === null) return { workspace: initialRealWorkspace(now), error: null, writable: true };
    if (raw.length > 4_000_000) throw new Error('workspace_too_large');
    const workspace = parseBriefingWorkspace(JSON.parse(raw));
    if (!workspace) throw new Error('invalid_workspace');
    return { workspace: withoutSampleContent(workspace), error: null, writable: true };
  } catch {
    return {
      workspace: initialRealWorkspace(now),
      error:
        '저장된 설정을 읽지 못했습니다. 원본은 보존하고 임시 화면을 열었습니다. 기존 데이터를 덮어쓰지 않도록 저장을 중단했습니다.',
      writable: false,
    };
  }
}
export function saveWorkspace(
  storage: Pick<Storage, 'setItem'>,
  workspace: BriefingWorkspace,
): string | null {
  try {
    const parsed = parseBriefingWorkspace(workspace);
    if (!parsed) throw new Error('invalid_workspace');
    const serialized = JSON.stringify(withoutSampleContent(parsed));
    if (serialized.length > 4_000_000) throw new Error('workspace_too_large');
    storage.setItem(BRIEFING_STORAGE_KEY, serialized);
    return null;
  } catch {
    return '설정을 저장하지 못했습니다. 이번 변경은 현재 화면에만 유지되며 새로고침하면 사라질 수 있습니다.';
  }
}
/** Manual fixture execution only: opening the app never starts a due/background run. */
export function runFixture(
  workspace: BriefingWorkspace,
  routineId: string,
  now: string,
  runId: string,
): BriefingWorkspace {
  const routine = workspace.routines.find((r) => r.id === routineId);
  if (!routine) throw new Error('routine_not_found');
  if (workspace.runs.some((r) => r.id === runId)) return workspace;
  const run = generateFixtureRun(routine, fixtureEvidence(now), {
    id: runId,
    scheduledFor: now,
    completedAt: now,
  });
  return { ...workspace, runs: [...workspace.runs, run].slice(-MAX_SAVED_RUNS) };
}
