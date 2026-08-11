export const EXPERIMENT_WORKSPACE_IPC_CHANNELS = {
  list: 'gosu:experiment-workspace:list',
  createIdea: 'gosu:experiment-workspace:create-idea',
  updateIdea: 'gosu:experiment-workspace:update-idea',
  recordMetric: 'gosu:experiment-workspace:record-metric',
  reviseLoggingTemplate: 'gosu:experiment-workspace:revise-logging-template',
  readRunLog: 'gosu:experiment-workspace:read-run-log',
  event: 'gosu:experiment-workspace:event',
} as const;
