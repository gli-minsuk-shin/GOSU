import { emptyPaperDates, type PaperDateFilters } from './paper-date-filters';
export function PaperDateControls({
  value,
  onChange,
}: {
  value: PaperDateFilters;
  onChange: (value: PaperDateFilters) => void;
}) {
  const active = Object.values(value).some((range) => range.from || range.to);
  return (
    <div className="briefing-paper-date-controls" aria-label="논문 기간 검색">
      {(['summary', 'published'] as const).map((key) => {
        const label = key === 'summary' ? '요약일' : '최초 공개일';
        return (
          <fieldset key={key}>
            <legend>{label}</legend>
            <div>
              <input
                type="date"
                aria-label={`${label} 시작일`}
                value={value[key].from}
                onChange={(e) =>
                  onChange({ ...value, [key]: { ...value[key], from: e.target.value } })
                }
              />
              <span aria-hidden="true">~</span>
              <input
                type="date"
                aria-label={`${label} 종료일`}
                value={value[key].to}
                onChange={(e) =>
                  onChange({ ...value, [key]: { ...value[key], to: e.target.value } })
                }
              />
            </div>
          </fieldset>
        );
      })}
      {active && (
        <button
          type="button"
          className="briefing-text-button"
          onClick={() => onChange(emptyPaperDates())}
        >
          기간 초기화
        </button>
      )}
    </div>
  );
}
