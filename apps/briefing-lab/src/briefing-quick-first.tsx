import type { BriefingSnapshot } from './briefing-history-snapshot';
import { briefingDate } from './briefing-agenda-days';
import { BriefingMarkdown } from './briefing-insight-card';
import './briefing-quick-first.css';

/** The metadata-only first briefing, shown above the detailed summaries as they are saved. */
export function BriefingQuickFirst({
  value,
  timeZone,
}: {
  value: NonNullable<BriefingSnapshot['quickBriefing']>;
  timeZone?: string;
}) {
  return (
    <div className="briefing-quick-first" role="note" aria-label="빠른 1차 브리핑">
      <p className="briefing-quick-first-label">
        빠른 1차 브리핑 · 메일 제목·보낸 사람으로 먼저 정리 · {value.previousAt ? '오늘 누적 ' : ''}
        이메일 {value.emailCount}통{value.paperCount ? ` · 논문 ${value.paperCount}편` : ''} ·{' '}
        {briefingDate(value.createdAt, timeZone ?? 'Asia/Seoul', true)}
        {value.previousAt
          ? ` · ${briefingDate(value.previousAt, timeZone ?? 'Asia/Seoul', true)} 브리핑에 이어서 업데이트`
          : ''}
      </p>
      <p className="briefing-quick-first-headline">
        <BriefingMarkdown inline text={value.headline} />
      </p>
      {value.points.length > 0 && (
        <ul>
          {value.points.map((point, index) => (
            <li
              key={index}
              className={
                value.previousAt
                  ? index < (value.newPoints ?? 0)
                    ? 'is-new'
                    : 'is-carried'
                  : undefined
              }
            >
              {value.previousAt && index < (value.newPoints ?? 0) && (
                <span className="briefing-quick-first-new">새로</span>
              )}
              <BriefingMarkdown inline text={point} />
            </li>
          ))}
        </ul>
      )}
      <p className="briefing-quick-first-note">
        본문을 읽은 자세한 요약은 아래 항목에 순서대로 저장됩니다.
      </p>
    </div>
  );
}
