import { randomUUID } from 'node:crypto';
import { briefingClientContext } from './briefing-client-context';
import type { AssistantProfile, BriefingWorkspaceStore } from './briefing-workspace-store';
import {
  BriefingGenerationStore,
  generationProfileDigest,
  generationProfileMatches,
  generationScheduled,
  nextGenerationDueAt,
} from './briefing-generation-store';
import {
  BriefingIntervalSchema,
  type BriefingRoutineSchedule,
  type GenerationStatus,
  type GenerationView,
} from './src/briefing-generation-contract';
type Run = (
  profile: AssistantProfile,
  signal: AbortSignal,
  update: (value: Partial<GenerationStatus>) => void,
  scheduled: boolean,
) => Promise<void | { emailKeys: string[]; retryMailInMs?: number }>;
export class BriefingGeneration {
  private jobs = new Map<
    string,
    { value: GenerationStatus; controller: AbortController; done: Promise<void> }
  >();
  private timer?: ReturnType<typeof setInterval>;
  /** Routines whose next automatic run is the one early look at a Mail that was not answering. */
  private mailFollowUps = new Set<string>();
  private ticking = false;
  private schedulerError: string | null = null;
  constructor(
    private workspace: Pick<BriefingWorkspaceStore, 'profile' | 'owns'> &
      Partial<Pick<BriefingWorkspaceStore, 'requiresPerRequestConfirmation'>>,
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
      routineSchedule: record?.routineSchedule ?? null,
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
  /**
   * Saves what runs this routine automatically: the interval, the routine's own delivery times, or
   * both. Passing `undefined` for the schedule keeps the saved one.
   */
  async configure(
    id: string,
    hours: number,
    signal: AbortSignal,
    routineSchedule?: BriefingRoutineSchedule | null,
  ) {
    const intervalHours = BriefingIntervalSchema.parse(hours),
      p = await this.profile(id);
    const current = await this.store.record(id);
    const schedule =
      routineSchedule === undefined ? (current?.routineSchedule ?? null) : routineSchedule;
    const scheduled = generationScheduled({ intervalHours, routineSchedule: schedule });
    if (scheduled && this.requiresConfirmation(p)) throw new Error('generation_always_required');
    const token = briefingClientContext.getStore();
    if (!token) throw new Error('assistant_client_required');
    const digest = generationProfileDigest(p);
    if (generationProfileDigest(await this.profile(id)) !== digest)
      throw new Error('assistant_settings_changed');
    await this.store.update(
      id,
      (r) => {
        r.intervalHours = intervalHours;
        r.routineSchedule = schedule;
        r.ownerToken = scheduled ? token : null;
        r.profileDigest = scheduled ? digest : null;
        r.nextDueAt = scheduled ? nextGenerationDueAt(r, this.clock()) : null;
        r.scheduleError = null;
      },
      signal,
    );
    if (!scheduled) this.jobs.get(id)?.controller.abort();
    return this.status(id);
  }
  async start(id: string, scheduled = false) {
    const p = await this.profile(id);
    if (scheduled) {
      const schedule = await this.store.record(id);
      if (
        !schedule ||
        !generationScheduled(schedule) ||
        !generationProfileMatches(p, schedule) ||
        this.requiresConfirmation(p)
      )
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
          // A manual run restarts the interval; a routine delivery time keeps its own clock.
          if (!scheduled && generationScheduled(r))
            r.nextDueAt = nextGenerationDueAt(r, this.clock());
        });
        const completedResult = await this.run(
          p,
          controller.signal,
          (update) =>
            Object.assign(value, update, { updatedAt: new Date(this.clock()).toISOString() }),
          scheduled,
        );
        if (controller.signal.aborted) throw new Error('source_cancelled');
        await this.followUpMail(p, value, completedResult?.retryMailInMs);
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
  /**
   * Mail did not answer during this run. An automatic routine looks again soon instead of leaving
   * the email section empty until the next interval; once, so a Mail that stays broken does not
   * turn into a run every ten minutes.
   */
  private async followUpMail(p: AssistantProfile, value: GenerationStatus, retryInMs?: number) {
    const id = p.routineId;
    if (!retryInMs || this.mailFollowUps.has(id)) {
      this.mailFollowUps.delete(id);
      return;
    }
    const at = new Date(this.clock() + retryInMs).toISOString();
    let due: string | null = null;
    await this.store.update(id, (r) => {
      // No due time means nothing runs automatically, or the schedule is paused until the user
      // confirms changed settings: neither is resumed from here.
      if (!generationScheduled(r) || !r.ownerToken || !r.nextDueAt) return;
      if (r.nextDueAt > at) r.nextDueAt = at;
      due = r.nextDueAt;
    });
    if (!due) return;
    this.mailFollowUps.add(id);
    const time = new Intl.DateTimeFormat('ko-KR', {
      timeZone: p.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(due));
    value.error = `${value.error ?? ''} Apple Mail은 ${time}쯤 자동으로 다시 확인합니다.`.trim();
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
          !generationScheduled(record) ||
          !record.nextDueAt ||
          Date.parse(record.nextDueAt) > this.clock() ||
          this.jobs.get(record.routineId)?.value.state === 'running'
        )
          continue;
        const claimed = await this.store.claim(record.routineId, this.clock());
        if (!claimed?.ownerToken) continue;
        await briefingClientContext.run(claimed.ownerToken, async () => {
          let acceptedDigest = claimed.profileDigest;
          try {
            const p = await this.profile(record.routineId);
            if (this.requiresConfirmation(p)) throw new Error('generation_confirmation_required');
            if (!generationProfileMatches(p, claimed))
              throw new Error('generation_settings_changed');
            await this.store.update(record.routineId, (r) => {
              if (
                r.profileDigest === claimed.profileDigest &&
                r.ownerToken === claimed.ownerToken &&
                r.intervalHours === claimed.intervalHours &&
                JSON.stringify(r.routineSchedule) === JSON.stringify(claimed.routineSchedule)
              ) {
                r.profileDigest = generationProfileDigest(p);
                r.scheduleError = null;
              }
            });
            acceptedDigest = generationProfileDigest(p);
            const current = await this.store.record(record.routineId);
            if (
              current?.intervalHours !== claimed.intervalHours ||
              JSON.stringify(current.routineSchedule) !== JSON.stringify(claimed.routineSchedule) ||
              current.ownerToken !== claimed.ownerToken ||
              current.nextDueAt !== claimed.nextDueAt
            )
              return;
            await this.start(record.routineId, true);
          } catch (error) {
            await this.store.update(record.routineId, (r) => {
              if (r.profileDigest !== acceptedDigest) return;
              if (!generationScheduled(r) || r.ownerToken !== claimed.ownerToken) return;
              const code = error instanceof Error ? error.message : '';
              const scopeChanged = [
                'generation_confirmation_required',
                'generation_settings_changed',
                'assistant_settings_changed',
                'assistant_client_required',
                'assistant_settings_required',
              ].includes(code);
              r.nextDueAt = scopeChanged ? null : new Date(this.clock() + 60000).toISOString();
              // Reselecting the interval or the routine times resumes it, as the message says.
              // Say which kind of approval is missing: the stored record keeps only a digest, so a
              // scope change names the items it covers rather than guessing which one moved.
              r.scheduleError = !scopeChanged
                ? '일시적으로 자동 실행 설정을 확인하지 못했습니다. 저장한 간격은 유지하며 1분 후 다시 확인합니다.'
                : code === 'generation_confirmation_required'
                  ? '설정 또는 권한 확인이 필요해 자동 생성을 일시 중지했습니다. 요청 허용이 ‘요청마다 확인’으로 되어 있어 자동 실행할 수 없습니다. 설정에서 ‘항상 허용’으로 바꾼 뒤 같은 간격을 선택하면 재개합니다.'
                  : code === 'generation_settings_changed'
                    ? '설정 또는 권한 확인이 필요해 자동 생성을 일시 중지했습니다. 자동 실행을 승인한 뒤 AI 제공자, 메일 계정·메일함, 메일 읽기·AI 전달, 캘린더, 할 일·프로젝트 읽기 중 하나가 바뀌었습니다. 바뀐 설정으로 계속하려면 같은 간격을 다시 선택해주세요.'
                    : '설정 또는 권한 확인이 필요해 자동 생성을 일시 중지했습니다. 이 앱 연결의 루틴 소유권 또는 저장된 설정을 확인하지 못했습니다. GOSU 설정의 Briefing Lab에서 설정을 저장한 뒤 같은 간격을 선택하면 재개합니다.';
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
  private requiresConfirmation(p: AssistantProfile) {
    return (
      this.workspace.requiresPerRequestConfirmation?.(p) ??
      p.preferences.confirmationPolicy !== 'always'
    );
  }
  close() {
    if (this.timer) clearInterval(this.timer);
    for (const job of this.jobs.values()) job.controller.abort();
  }
}
