import { useRef, useState, type ReactNode } from 'react';
import {
  briefingSectionOrder,
  moveBriefingSection,
  groupBriefingSections,
  type BriefingRoutine,
  type BriefingRun,
  type RankedEvidence,
  type SourceKind,
} from '@gosu/briefing-core';

type Labels = Readonly<Record<SourceKind, string>>;

export function SectionOrderEditor({
  routine,
  labels,
  onChange,
}: {
  routine: BriefingRoutine;
  labels: Labels;
  onChange: (order: SourceKind[]) => void;
}) {
  const [dragging, setDragging] = useState<SourceKind | null>(null);
  const order = briefingSectionOrder(routine.sectionOrder).filter(
    (kind) => (kind === 'funding') === (routine.kind === 'funding'),
  );
  const move = (kind: SourceKind, target: SourceKind) =>
    onChange(moveBriefingSection(routine.sectionOrder, kind, target));
  return (
    <section className="briefing-settings-section">
      <header>
        <span className="briefing-step">04</span>
        <div>
          <h2>브리핑 표시 순서</h2>
          <p>
            행을 드래그하거나 위·아래 버튼으로 순서를 바꾸세요. 설정 저장 후 기존 브리핑에도
            적용됩니다.
          </p>
        </div>
      </header>
      <ol className="briefing-section-order" aria-label="브리핑 섹션 표시 순서">
        {order.map((kind, index) => (
          <li
            key={kind}
            data-section-kind={kind}
            className={dragging === kind ? 'dragging' : ''}
            draggable={order.length > 1}
            onDragStart={(event) => {
              setDragging(kind);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('application/x-gosu-briefing-section', kind);
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => {
              event.preventDefault();
              const source = event.dataTransfer.getData(
                'application/x-gosu-briefing-section',
              ) as SourceKind;
              if (order.includes(source)) move(source, kind);
              setDragging(null);
            }}
          >
            <span className="briefing-drag-handle" aria-hidden="true">
              ⠿
            </span>
            <span className="briefing-order-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="briefing-order-name">
              <strong>{labels[kind]}</strong>
              <small>
                {routine.sources.some((source) => source.kind === kind)
                  ? '선택한 구독'
                  : '구독 선택 시 이 위치에 표시'}
              </small>
            </span>
            <button
              type="button"
              className="briefing-icon-button"
              aria-label={`${labels[kind]} 섹션 위로`}
              disabled={index === 0}
              onClick={() => move(kind, order[index - 1]!)}
            >
              ↑
            </button>
            <button
              type="button"
              className="briefing-icon-button"
              aria-label={`${labels[kind]} 섹션 아래로`}
              disabled={index === order.length - 1}
              onClick={() => move(kind, order[index + 1]!)}
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
      <p className="briefing-muted">
        이메일은 이메일끼리, 논문은 논문끼리 묶습니다. 각 섹션 안에서는 관련성 순위를 유지합니다.
        비어 있는 종류는 결과 화면에서 생략합니다.
      </p>
    </section>
  );
}

export function BriefingSections({
  run,
  order,
  labels,
  renderItem,
}: {
  run: BriefingRun;
  order?: readonly SourceKind[] | undefined;
  labels: Labels;
  renderItem: (item: RankedEvidence, index: number) => ReactNode;
}) {
  const sections = groupBriefingSections(run, order);
  const [expanded, setExpanded] = useState<readonly SourceKind[]>([]);
  const refs = useRef<Partial<Record<SourceKind, HTMLDetailsElement>>>({});
  const setOpen = (kind: SourceKind, open: boolean) =>
    setExpanded((previous) =>
      open ? [...new Set([...previous, kind])] : previous.filter((item) => item !== kind),
    );
  if (!sections.length) return null;
  return (
    <div className="briefing-grouped-content">
      <nav className="briefing-section-overview" aria-label="종류별 브리핑 한눈에">
        {sections.map(({ kind, items }) => (
          <button
            key={kind}
            type="button"
            className={`briefing-section-tile ${kind}`}
            aria-label={`${labels[kind]} ${items.length}건 보기`}
            onClick={() => {
              setOpen(kind, true);
              refs.current[kind]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }}
          >
            <span>{labels[kind]}</span>
            <strong>
              {items.length}
              <small>건</small>
            </strong>
          </button>
        ))}
      </nav>
      <div className="briefing-section-controls">
        <span>종류별 요약 · 눌러서 자세히 보기</span>
        <div>
          <button
            type="button"
            className="briefing-text-button"
            onClick={() => setExpanded(sections.map((section) => section.kind))}
          >
            모두 펼치기
          </button>
          <button type="button" className="briefing-text-button" onClick={() => setExpanded([])}>
            모두 접기
          </button>
        </div>
      </div>
      <div className="briefing-section-list">
        {sections.map(({ kind, items, hiddenCount }) => (
          <details
            key={kind}
            className={`briefing-content-section ${kind}`}
            data-section-kind={kind}
            ref={(element) => {
              if (element) refs.current[kind] = element;
              else delete refs.current[kind];
            }}
            open={expanded.includes(kind)}
            onToggle={(event) => setOpen(kind, event.currentTarget.open)}
          >
            <summary>
              <div className="briefing-section-heading">
                <span className="briefing-section-chevron" aria-hidden="true">
                  ›
                </span>
                <h3>{labels[kind]}</h3>
                <span className="briefing-section-count">{items.length}건</span>
                {items.some((item) => item.evidence.deadline) && (
                  <small className="briefing-section-deadlines">
                    마감 {items.filter((item) => item.evidence.deadline).length}건
                  </small>
                )}
              </div>
              <div className="briefing-section-headlines">
                {items.length ? (
                  items.slice(0, 2).map(({ evidence }) => <p key={evidence.id}>{evidence.title}</p>)
                ) : (
                  <p>이 섹션의 카드를 모두 숨겼습니다.</p>
                )}
                {items.length > 2 && <small>외 {items.length - 2}건 · 펼쳐서 확인</small>}
                {hiddenCount > 0 && <small>숨김 {hiddenCount}건</small>}
              </div>
            </summary>
            <div className="briefing-cards">{items.map(renderItem)}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
