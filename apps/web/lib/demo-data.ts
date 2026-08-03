export type Project = {
  id: string;
  name: string;
  shortName: string;
  phase: string;
  primaryMetric: string;
  bestMetric: string;
  delta: string;
  color: string;
};

export type TrialPoint = {
  trial: number;
  value: number;
};

export const projects = [
  {
    id: 'project-vision',
    name: 'Efficient Vision Adaptation',
    shortName: 'EVA',
    phase: 'Experimenting',
    primaryMetric: 'Validation accuracy',
    bestMetric: '87.4%',
    delta: '+3.8%',
    color: '#9ef01a',
  },
  {
    id: 'project-retrieval',
    name: 'Scientific Retrieval',
    shortName: 'SR',
    phase: 'Writing',
    primaryMetric: 'nDCG@10',
    bestMetric: '0.712',
    delta: '+0.041',
    color: '#78a6ff',
  },
  {
    id: 'project-reasoning',
    name: 'Robust Agent Reasoning',
    shortName: 'RAR',
    phase: 'Review',
    primaryMetric: 'Pass@1',
    bestMetric: '64.2%',
    delta: '+6.1%',
    color: '#ff9f66',
  },
] as const satisfies readonly Project[];

export const objectiveTrend: TrialPoint[] = [
  { trial: 1, value: 83.6 },
  { trial: 2, value: 84.1 },
  { trial: 3, value: 83.9 },
  { trial: 4, value: 85.2 },
  { trial: 5, value: 85.8 },
  { trial: 6, value: 85.4 },
  { trial: 7, value: 86.7 },
  { trial: 8, value: 87.4 },
];

export const board = [
  {
    title: 'Backlog',
    items: [
      { title: 'Evaluate augmentation ablation', tag: 'Experiment', owner: 'MS' },
      { title: 'Verify two citations', tag: 'Reference', owner: 'JL' },
    ],
  },
  {
    title: 'Planned',
    items: [
      { title: 'Run seed robustness sweep', tag: 'Experiment', owner: 'AI' },
      { title: 'Draft limitations section', tag: 'Paper', owner: 'MS' },
    ],
  },
  {
    title: 'In Progress',
    items: [{ title: 'Trial 8 · adapter rank 24', tag: 'Running', owner: 'R1' }],
  },
  {
    title: 'Review',
    items: [{ title: 'Results paragraph revision', tag: 'Review', owner: 'SK' }],
  },
  {
    title: 'Done',
    items: [{ title: 'Lock validation protocol v3', tag: 'Metric', owner: 'MS' }],
  },
];
