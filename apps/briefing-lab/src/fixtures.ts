import type { BriefingEvidence, BriefingSource, BriefingWorkspace } from '@gosu/briefing-core';

export const SOURCE_CATALOG: readonly BriefingSource[] = [
  { id: 'sample-email', kind: 'email', label: '선택한 메일 · 샘플', origin: 'fixture' },
  { id: 'sample-calendar', kind: 'calendar', label: '연구 일정 · 샘플', origin: 'fixture' },
  { id: 'sample-todo', kind: 'todo', label: '마감일이 있는 할 일 · 샘플', origin: 'fixture' },
  { id: 'sample-papers', kind: 'papers', label: '새 논문 · 샘플', origin: 'fixture' },
  { id: 'sample-weather', kind: 'weather', label: '날씨 · 샘플', origin: 'fixture' },
  { id: 'sample-ai-news', kind: 'ai-news', label: 'AI 주요 소식 · 샘플', origin: 'fixture' },
  { id: 'sample-news', kind: 'news', label: '일반 뉴스 · 샘플', origin: 'fixture' },
  { id: 'sample-conference', kind: 'conference', label: '학회 마감일 · 샘플', origin: 'fixture' },
  {
    id: 'sample-funding-kr',
    kind: 'funding',
    label: '한국 IRIS · 공고 예시',
    url: 'https://www.iris.go.kr/contents/retrieveBsnsAncmListView.do',
    country: 'KR',
    origin: 'fixture',
  },
  {
    id: 'sample-funding-us',
    kind: 'funding',
    label: '미국 Grants.gov · 공고 예시',
    url: 'https://www.grants.gov/search-grants',
    country: 'US',
    origin: 'fixture',
  },
  {
    id: 'sample-funding-eu',
    kind: 'funding',
    label: 'EU Funding & Tenders · 공고 예시',
    url: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
    country: 'EU',
    origin: 'fixture',
  },
];

const shifted = (now: string, days: number) =>
  new Date(Date.parse(now) + days * 86_400_000).toISOString();
/** Entirely synthetic evidence. No fixture describes an actual email, paper, or grant. */
export function fixtureEvidence(now: string): BriefingEvidence[] {
  const base = { publishedAt: shifted(now, -1), readScope: 'fixture' as const };
  return [
    {
      ...base,
      id: 'demo-paper-optimization',
      sourceId: 'sample-papers',
      kind: 'papers',
      title: '[샘플 논문] 학습형 최적화의 안정성과 gradient 흐름',
      abstract:
        'Learned optimization and neural networks: convergence and gradient flow in iterative solvers.',
      summary:
        '반복 solver의 안정성과 gradient 흐름을 비교하는 가상의 논문입니다. 실제 논문 검색이나 LLM 요약 결과가 아닙니다.',
    },
    {
      ...base,
      id: 'demo-paper-statistics',
      sourceId: 'sample-papers',
      kind: 'papers',
      title: '[샘플 논문] Statistical learning을 위한 조건부 모델',
      abstract: 'Conditional neural networks for statistical learning and estimation.',
      summary:
        '조건부 신경망과 통계적 추정의 연결을 살펴보는 예시입니다. 제목·초록의 키워드 매칭 순위를 시험할 수 있습니다.',
    },
    {
      ...base,
      id: 'demo-paper-unrelated',
      sourceId: 'sample-papers',
      kind: 'papers',
      title: '[샘플 논문] 천체 관측 장비의 교정',
      abstract: 'Calibration of telescopes for astronomy observations.',
      summary:
        '관심 키워드와 일치하지 않는 자료가 어떤 순서로 나타나는지 확인하기 위한 가상 항목입니다.',
    },
    {
      ...base,
      id: 'demo-email',
      sourceId: 'sample-email',
      kind: 'email',
      title: '[샘플 메일] 연구 미팅 전 검토 요청',
      abstract: 'Neural networks 연구 계획과 optimization baseline 검토 요청.',
      summary:
        '다음 미팅에서 비교할 baseline 두 가지를 정리해 달라는 가상 메일입니다. Apple Mail에 접근하지 않았습니다.',
      deadline: shifted(now, 2),
    },
    {
      ...base,
      id: 'demo-calendar',
      sourceId: 'sample-calendar',
      kind: 'calendar',
      title: '[샘플 일정] 모델 설계 리뷰',
      abstract: 'Neural networks architecture review meeting.',
      summary:
        '설계 의도·수식·코드의 일관성을 검토하는 가상 일정입니다. 실제 캘린더와 연결되지 않았습니다.',
      deadline: shifted(now, 1),
    },
    {
      ...base,
      id: 'demo-task',
      sourceId: 'sample-todo',
      kind: 'todo',
      title: '[샘플 할 일] Optimization 실험 계획 확정',
      abstract: 'Optimization baseline 실험 계획에 데이터·평가지표·마감일 기입.',
      summary:
        '마감일이 지정된 가상의 미완료 task만 브리핑에 포함합니다. GOSU의 실제 task는 읽거나 변경하지 않습니다.',
      deadline: shifted(now, 3),
    },
    {
      ...base,
      id: 'demo-task-no-deadline',
      sourceId: 'sample-todo',
      kind: 'todo',
      title: '[필터 시험] 마감일 없는 아이디어',
      abstract: 'Optimization 아이디어 메모.',
      summary: '마감일이 없어 브리핑에서 제외되어야 하는 fixture입니다.',
    },
    {
      ...base,
      id: 'demo-weather',
      sourceId: 'sample-weather',
      kind: 'weather',
      title: '[샘플 날씨] 외부 일정 전 예보 확인',
      abstract: 'Weather preview only.',
      summary: '실제 예보·도시·위치를 조회하지 않았습니다. 날씨 어댑터가 연결될 자리입니다.',
    },
    {
      ...base,
      id: 'demo-ai-news',
      sourceId: 'sample-ai-news',
      kind: 'ai-news',
      title: '[샘플 AI 소식] 연구 도구 업데이트',
      abstract: 'New research tooling for neural networks and optimization.',
      summary:
        '선택한 공식 발표 소스의 변경을 묶어 보여주는 카드 예시입니다. 실제 최신 소식이 아닙니다.',
    },
    {
      ...base,
      id: 'demo-news',
      sourceId: 'sample-news',
      kind: 'news',
      title: '[샘플 뉴스] 연구 인프라 소식',
      abstract: 'Research infrastructure preview.',
      summary: '일반 뉴스 소스 연결 전의 가상 데이터입니다.',
    },
    {
      ...base,
      id: 'demo-conference',
      sourceId: 'sample-conference',
      kind: 'conference',
      title: '[샘플 학회] 제출 준비 일정',
      abstract: 'Neural networks conference preparation deadline.',
      summary:
        '연구 주제에 관련된 학회 마감일을 놓치지 않도록 보여주는 예시입니다. ICLR 등 실제 학회의 마감일을 의미하지 않습니다.',
      deadline: shifted(now, 7),
    },
    {
      ...base,
      id: 'demo-funding-kr',
      sourceId: 'sample-funding-kr',
      kind: 'funding',
      country: 'KR',
      title: '[샘플 공고] 신경망·최적화 기초연구 지원',
      abstract: 'Neural networks and optimization basic research funding.',
      summary:
        '가상의 연구과제 카드입니다. 지원 금액·신청 자격·실제 마감일은 확인된 정보가 없으며, 링크는 공식 사이트 진입점입니다.',
      deadline: shifted(now, 14),
      url: SOURCE_CATALOG.find((s) => s.id === 'sample-funding-kr')!.url!,
    },
    {
      ...base,
      id: 'demo-funding-us',
      sourceId: 'sample-funding-us',
      kind: 'funding',
      country: 'US',
      title: '[샘플 공고] Statistical learning 방법론',
      abstract: 'Statistical learning and robust estimation research.',
      summary:
        '미국 소스 선택을 시험하는 가상 공고입니다. 현재 위치나 국가 선택만으로 신청 가능하다고 판단하지 않습니다.',
      deadline: shifted(now, 21),
      url: SOURCE_CATALOG.find((s) => s.id === 'sample-funding-us')!.url!,
    },
    {
      ...base,
      id: 'demo-funding-eu',
      sourceId: 'sample-funding-eu',
      kind: 'funding',
      country: 'EU',
      title: '[샘플 공고] 국제 협력 AI 연구',
      abstract: 'International neural networks research cooperation.',
      summary:
        '다국가 소스 선택을 확인하기 위한 가상 공고입니다. 실제 수집·공고 검증은 후속 단계에서 연결합니다.',
      deadline: shifted(now, 28),
      url: SOURCE_CATALOG.find((s) => s.id === 'sample-funding-eu')!.url!,
    },
  ];
}

export function initialWorkspace(now = new Date().toISOString()): BriefingWorkspace {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  const schedule = {
    frequency: 'daily' as const,
    interval: 1,
    anchorDate: date,
    timeZone: 'Asia/Seoul',
    times: ['08:00'],
    weekdays: [1, 2, 3, 4, 5],
    monthDay: 1,
  };
  const interest = {
    keywords: [
      { term: 'optimization', weight: 5, synonyms: ['최적화'] },
      { term: 'neural networks', weight: 4, synonyms: ['신경망'] },
      { term: 'statistical learning', weight: 3, synonyms: ['통계적 학습'] },
    ],
    excluded: [],
  };
  return {
    schemaVersion: 1,
    selectedRoutineId: 'personal-research',
    routines: [
      {
        id: 'personal-research',
        name: '개인·연구 브리핑',
        kind: 'personal',
        state: 'draft',
        schedule,
        interest: structuredClone(interest),
        sources: SOURCE_CATALOG.filter((s) =>
          ['sample-email', 'sample-calendar', 'sample-todo', 'sample-papers'].includes(s.id),
        ),
        countries: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'funding-research',
        name: '연구과제 브리핑',
        kind: 'funding',
        state: 'draft',
        schedule: { ...schedule, times: ['09:00'] },
        interest: structuredClone(interest),
        sources: SOURCE_CATALOG.filter((s) => s.kind === 'funding'),
        countries: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    runs: [],
  };
}
