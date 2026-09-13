import type { BriefingWorkspace } from '@gosu/briefing-core';
export function RoutineManager({
  workspace,
  onCollect,
  onSettings,
}: {
  workspace: BriefingWorkspace;
  onCollect: (routineId: string) => void;
  onSettings: (routineId: string) => void;
}) {
  return (
    <section className="briefing-routine-manager" aria-label="루틴 관리">
      <p className="briefing-muted">
        연결 설정과 연구 관심사를 관리합니다. 저장된 브리핑은 개인 연구 브리핑에서 최신순으로 읽을
        수 있습니다.
      </p>
      <div className="briefing-routine-manager-list">
        {workspace.routines.map((routine) => (
          <article key={routine.id}>
            <h2>{routine.name}</h2>
            <div className="briefing-live-actions">
              <button
                type="button"
                className="briefing-button"
                aria-label={routine.name + ' 설정'}
                onClick={() => onSettings(routine.id)}
              >
                루틴 설정
              </button>
              {routine.kind === 'personal' && (
                <button
                  type="button"
                  className="briefing-button"
                  aria-label={routine.name + ' 실제 브리핑'}
                  onClick={() => onCollect(routine.id)}
                >
                  실제 브리핑
                </button>
              )}
            </div>
          </article>
        ))}
        {!workspace.routines.length && <p>새 루틴을 만들어 실제 소스를 연결하세요.</p>}
      </div>
    </section>
  );
}
