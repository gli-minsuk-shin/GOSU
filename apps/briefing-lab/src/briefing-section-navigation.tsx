import { briefingTargetId, type BriefingJumpTarget } from './briefing-jump';

export function BriefingSectionNavigation({
  sections,
  scope,
  onNavigate,
}: {
  sections: { kind: 'email' | 'papers'; count: number; id: string }[];
  scope: string;
  onNavigate: (target: BriefingJumpTarget) => void;
}) {
  if (!sections.length) return null;
  return (
    <nav className="briefing-section-navigation" aria-label="브리핑 바로가기">
      {[...sections]
        .sort((a, b) => Number(b.kind === 'papers') - Number(a.kind === 'papers'))
        .map((section) => (
          <button
            key={section.kind}
            type="button"
            className={`briefing-section-link ${section.kind}`}
            aria-label={`${section.kind === 'papers' ? '논문' : '이메일'} 바로 보기`}
            aria-controls={briefingTargetId(scope, section.kind, section.id)}
            onClick={() => onNavigate(section)}
          >
            {section.kind === 'papers' ? '논문' : '이메일'} <span>{section.count}</span> ↓
          </button>
        ))}
    </nav>
  );
}
