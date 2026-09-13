const labels = {
  high: '높음',
  medium: '보통',
  low: '낮음',
  uncertain: '판단 보류',
  pending: '분석 전',
};
export function ImportanceIcon({
  level = 'pending',
  paper = false,
}: {
  level?: keyof typeof labels;
  paper?: boolean;
}) {
  const label = `${paper ? '연구 우선순위' : '중요도'} · ${labels[level]}`;
  const bars = level === 'high' ? 3 : level === 'medium' ? 2 : level === 'low' ? 1 : 0;
  return (
    <span
      className={`briefing-importance-icon ${level}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
        {bars ? (
          [0, 1, 2].map((i) => (
            <rect
              key={i}
              x={3 + i * 7}
              y={15 - i * 5}
              width="4"
              height={6 + i * 5}
              rx="1"
              fill="currentColor"
              opacity={i < bars ? 1 : 0.18}
            />
          ))
        ) : (
          <>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 16v1"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </span>
  );
}
