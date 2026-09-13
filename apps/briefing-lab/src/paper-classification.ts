import { z } from 'zod';
export const PAPER_TAXONOMY_VERSION = 1;
export const PAPER_CATEGORIES = [
  {
    id: 'generative',
    label: '생성 모델·LLM',
    description: '언어 모델, 텍스트·이미지 생성, 확산 모델, 생성 모델의 정렬과 평가',
  },
  {
    id: 'vision',
    label: '컴퓨터 비전',
    description: '영상 이해, 인식, 분할, 검출, 3차원 시각 추론',
  },
  {
    id: 'agents',
    label: '강화학습·에이전트',
    description: '강화학습, 의사결정, 자율 에이전트, 로봇 제어와 계획',
  },
  {
    id: 'statistics',
    label: '통계·최적화',
    description: '통계적 추론, 베이지안·인과 추론, 최적화 방법과 수치 추정',
  },
  {
    id: 'learning',
    label: '머신러닝 이론·학습',
    description: '학습 이론, 일반화, 표현 학습, 지도·자기지도 학습과 일반 모델 구조',
  },
  {
    id: 'systems',
    label: '시스템·효율화',
    description: '추론·학습 시스템, 모델 압축, 양자화, 분산 처리와 하드웨어 효율',
  },
  {
    id: 'mathematics',
    label: '수학·알고리즘',
    description: '수학적 구조·증명, 일반 알고리즘, 계산 복잡도와 비학습 수치 해석',
  },
  {
    id: 'science',
    label: '과학·의학 응용',
    description: '물리·화학·생명·의학·공학의 과학적 문제 또는 도메인 응용이 핵심인 연구',
  },
  {
    id: 'society',
    label: '인간·사회·정책',
    description: '인간과 컴퓨터 상호작용, 심리·교육·사회, 윤리와 정책',
  },
  {
    id: 'other',
    label: '기타 연구',
    description: '다른 분류에 맞지 않거나 저장된 요약의 정보가 부족해 판단하기 어려운 연구',
  },
] as const;
export const PaperCategorySchema = z.enum([
  'generative',
  'vision',
  'agents',
  'statistics',
  'learning',
  'systems',
  'mathematics',
  'science',
  'society',
  'other',
]);
export type PaperCategory = z.infer<typeof PaperCategorySchema>;
export const paperCategoryLabel = (id: PaperCategory) =>
  PAPER_CATEGORIES.find((c) => c.id === id)!.label;
export const PaperClassificationSchema = z
  .object({
    taxonomyVersion: z.literal(PAPER_TAXONOMY_VERSION),
    categoryId: PaperCategorySchema,
    source: z.enum(['ai', 'user']),
    reason: z.string().max(300),
    summaryDigest: z.string().regex(/^[a-f0-9]{64}$/),
    classifiedAt: z.string().datetime(),
    revision: z.number().int().positive(),
    inputTruncated: z.boolean().optional(),
    invocation: z
      .object({
        providerId: z.string().max(128),
        model: z.string().max(256),
        reasoning: z.string().max(128).nullable(),
      })
      .strict()
      .optional(),
    stale: z.boolean().optional(),
  })
  .strict();
export type PaperClassification = z.infer<typeof PaperClassificationSchema>;
export const ClassificationRecordSchema = z
  .object({
    key: z.string().regex(/^[a-f0-9]{64}$/),
    routineId: z.string().max(128).nullable(),
    value: PaperClassificationSchema,
  })
  .strict();
export type ClassificationRecord = z.infer<typeof ClassificationRecordSchema>;
export const ClassificationTargetSchema = z
  .object({
    key: z.string().regex(/^[a-f0-9]{64}$/),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const ClassifyPapersRequestSchema = z
  .object({
    routineId: z.string().min(1).max(128),
    targets: z.array(ClassificationTargetSchema).min(1).max(6),
    refresh: z.boolean().optional(),
  })
  .strict();
export const EditClassificationSchema = z
  .object({
    routineId: z.string().min(1).max(128),
    target: ClassificationTargetSchema,
    categoryId: PaperCategorySchema,
  })
  .strict();
