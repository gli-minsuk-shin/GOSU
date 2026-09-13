import { randomUUID } from 'node:crypto';
import { briefingClientContext } from './briefing-client-context';
import type { AssistantProfile, BriefingWorkspaceStore } from './briefing-workspace-store';
import { BriefingGenerationStore, generationProfileDigest } from './briefing-generation-store';
import {
  BriefingIntervalSchema,
  type GenerationStatus,
  type GenerationView,
} from './src/briefing-generation-contract';
type Run = (
  profile: AssistantProfile,
  signal: AbortSignal,
  update: (value: Partial<GenerationStatus>) => void,
  scheduled: boolean,
) => Promise<void | { emailKeys: string[] }>;
export class BriefingGeneration {
  private jobs = new Map<
    string,
    { value: GenerationStatus; controller: AbortController; done: Promise<void> }
  >();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private schedulerError: string | null = null;
  constructor(
    private workspace: Pick<BriefingWorkspaceStore, 'profile' | 'owns'>,
    private run: Run,
    private errorMessage: (e: unknown) => string,
    readonly store = new BriefingGenerationStore(),
    private clock = Date.now,
    private completed?: (
      profile: AssistantProfile,
      job: GenerationStatus,
      signal: AbortSignal,
      result?: { emailKeys: string[] },
    ) => Promise<void>,
  ) {}
  private async profile(id: string) {
    const p = await this.workspace.profile(id);
    if (!p) throw new Error('assistant_settings_required');
    if (!this.workspace.owns(p)) throw new Error('assistant_client_required');
    return p;
  }
  private view(
    record: Awaited<ReturnType<BriefingGenerationStore['record']>>,
    routineId: string,
  ): GenerationView {
    const job = this.jobs.get(routineId)?.value ?? record?.job ?? null;
    return {
      intervalHours: record?.intervalHours ?? 0,
      nextDueAt: record?.nextDueAt ?? null,
      scheduleError: this.schedulerError ?? record?.scheduleError ?? null,
      job:
        job?.state === 'running' && !this.jobs.has(routineId)
          ? {
              ...job,
              state: 'interrupted',
              detail: '서버가 종료되어 이전 생성이 중단됐습니다. 저장된 항목은 유지됩니다.',
            }
          : job,
    };
  }
  async status(id: string) {
    await this.profile(id);
    return this.view(await this.store.record(id), id);
  }
  async configure(id: string, hours: number, signal: AbortSignal) {
    const intervalHours = BriefingIntervalSchema.parse(hours),
      p = await this.profile(id);
    if (intervalHours && p.preferences.confirmationPolicy !== 'always')
      throw new Error('generation_always_required');
    const token = briefingClientContext.getStore();
    if (!token) throw new Error('assistant_client_required');
    const digest = generationProfileDigest(p);
    if (generationProfileDigest(await this.profile(id)) !== digest)
      throw new Error('assistant_settings_changed');
    await this.store.update(
      id,
      (r) => {
        r.intervalHours = intervalHours;
        r.ownerToken = intervalHours ? token : null;
        r.profileDigest = intervalHours ? digest : null;
        r.nextDueAt = intervalHours
          ? new Date(this.clock() + intervalHours * 3600000).toISOString()
          : null;
        r.scheduleError = null;
      },
      signal,
    );
    if (!intervalHours) this.jobs.get(id)?.controller.abort();
    return this.status(id);
  }
  async start(id: string, scheduled = false) {
    const p = await this.profile(id);
    if (scheduled) {
      const schedule = await this.store.record(id);
      if (!schedule?.intervalHours || schedule.profileDigest !== generationProfileDigest(p))
        throw new Error('generation_settings_changed');
    }
    const existing = this.jobs.get(id);
    if (existing?.value.state === 'running') return this.status(id);
    if ([...this.jobs.values()].filter((j) => j.value.state === 'running').length >= 2)
      throw new Error('generation_busy');
    const controller = new AbortController(),
      at = new Date(this.clock()).toISOString();
    const value: GenerationStatus = {
      id: randomUUID(),
      routineId: id,
      runId: null,
      state: 'running',
      detail: '브리핑 준비 중…',
      newCount: 0,
      startedAt: at,
      updatedAt: at,
      error: null,
    };
    const job = { value, controller, done: Promise.resolve() };
    this.jobs.set(id, job);
    job.done = (async () => {
      const timeout = setTimeout(() => controller.abort(), 20 * 60000);
      try {
        await this.store.update(id, (r) => {
          r.job = structuredClone(value);
          if (!scheduled && r.intervalHours)
            r.nextDueAt = new Date(this.clock() + r.intervalHours * 3600000).toISOString();
        });
        const completedResult = await this.run(
          p,
          controller.signal,
          (update) =>
            Object.assign(value, update, { updatedAt: new Date(this.clock()).toISOString() }),
          scheduled,
        );
        if (controller.signal.aborted) throw new Error('source_cancelled');
        value.state = 'complete';
        value.detail = value.error
          ? `일부 자료 확인 필요 · ${value.newCount}개 추가 · 기존 브리핑 유지`
          : value.newCount
            ? value.addedSummaries
              ? `요약 추가 완료 · 이메일 ${value.addedSummaries.email}개 · 새 논문 ${value.addedSummaries.papers}개`
              : `새 항목 ${value.newCount}개 추가 완료`
            : value.todoCount !== undefined
              ? `일정·할 일 업데이트 완료 · 미완료 할 일 ${value.todoCount}개`
              : '새 항목 없음 · 기존 브리핑 유지';
        try {
          await this.completed?.(p, value, controller.signal, completedResult ?? undefined);
        } catch {
          value.error = value.error ?? '브리핑은 저장했지만 알림을 저장하지 못했습니다.';
          value.detail += ' · 알림 저장 확인 필요';
        }
        if (controller.signal.aborted) throw new Error('source_cancelled');
      } catch (e) {
        value.state = controller.signal.aborted ? 'cancelled' : 'failed';
        value.error = this.errorMessage(e);
        value.detail = controller.signal.aborted
          ? '생성을 중단했습니다. 저장된 항목은 유지됩니다.'
          : '브리핑 생성 중 일부 작업을 완료하지 못했습니다.';
      } finally {
        clearTimeout(timeout);
        value.updatedAt = new Date(this.clock()).toISOString();
        await this.store
          .update(id, (r) => {
            r.job = structuredClone(value);
          })
          .catch(() => {
            value.error = '실행 상태를 저장하지 못했습니다.';
          });
      }
    })();
    return this.view(await this.store.record(id), id);
  }
  async cancel(id: string) {
    await this.profile(id);
    this.jobs.get(id)?.controller.abort();
    return this.status(id);
  }
  async wait(id: string) {
    await this.jobs.get(id)?.done;
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.schedulerError = null;
      for (const record of await this.store.records()) {
        if ([...this.jobs.values()].filter((j) => j.value.state === 'running').length >= 2) break;
        if (
          !record.intervalHours ||
          !record.nextDueAt ||
          Date.parse(record.nextDueAt) > this.clock() ||
          this.jobs.get(record.routineId)?.value.state === 'running'
        )
          continue;
        const claimed = await this.store.claim(record.routineId, this.clock());
        if (!claimed?.ownerToken) continue;
        await briefingClientContext.run(claimed.ownerToken, async () => {
          try {
            const p = await this.profile(record.routineId);
            if (
              p.preferences.confirmationPolicy !== 'always' ||
              generationProfileDigest(p) !== claimed.profileDigest
            )
              throw new Error('generation_settings_changed');
            await this.start(record.routineId, true);
          } catch {
            await this.store.update(record.routineId, (r) => {
              r.intervalHours = 0;
              r.ownerToken = null;
              r.nextDueAt = null;
              r.scheduleError =
                '설정 또는 권한이 변경되어 자동 생성을 중지했습니다. 간격을 다시 선택해주세요.';
            });
          }
        });
      }
    } finally {
      this.ticking = false;
    }
  }
  startTimer() {
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.tick().catch(() => {
          this.schedulerError =
            '자동 실행 상태를 읽지 못했습니다. 서버와 로컬 저장소 상태를 확인해주세요.';
        });
      }, 30000);
      this.timer.unref?.();
    }
  }
  close() {
    if (this.timer) clearInterval(this.timer);
    for (const job of this.jobs.values()) job.controller.abort();
  }
}
