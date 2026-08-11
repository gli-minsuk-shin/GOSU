export const MANUSCRIPT_WORKSPACE_IPC_CHANNELS = {
  list: 'gosu:manuscript-workspace:list',
  create: 'gosu:manuscript-workspace:create',
  update: 'gosu:manuscript-workspace:update',
  connectOverleafGit: 'gosu:manuscript-workspace:connect-overleaf-git',
  inspect: 'gosu:manuscript-workspace:inspect',
  fetchCheckpoint: 'gosu:manuscript-workspace:fetch-checkpoint',
  disconnect: 'gosu:manuscript-workspace:disconnect',
} as const;
