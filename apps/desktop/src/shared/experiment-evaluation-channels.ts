export const EXPERIMENT_EVALUATION_IPC_CHANNELS = {
  list: 'gosu:experiment-evaluation:list',
  detail: 'gosu:experiment-evaluation:detail',
  createSession: 'gosu:experiment-evaluation:create-session',
  send: 'gosu:experiment-evaluation:send',
  cancel: 'gosu:experiment-evaluation:cancel',
  approve: 'gosu:experiment-evaluation:approve',
  reuseProfile: 'gosu:experiment-evaluation:reuse-profile',
  event: 'gosu:experiment-evaluation:event',
} as const;
