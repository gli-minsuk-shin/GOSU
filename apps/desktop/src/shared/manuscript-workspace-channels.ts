export const MANUSCRIPT_WORKSPACE_IPC_CHANNELS = {
  list: 'gosu:manuscript-workspace:list',
  create: 'gosu:manuscript-workspace:create',
  update: 'gosu:manuscript-workspace:update',
  connectOverleafGit: 'gosu:manuscript-workspace:connect-overleaf-git',
  inspect: 'gosu:manuscript-workspace:inspect',
  fetchCheckpoint: 'gosu:manuscript-workspace:fetch-checkpoint',
  listCheckpointFiles: 'gosu:manuscript-workspace:list-checkpoint-files',
  readCheckpointFile: 'gosu:manuscript-workspace:read-checkpoint-file',
  compilePdf: 'gosu:manuscript-workspace:compile-pdf',
  disconnect: 'gosu:manuscript-workspace:disconnect',
} as const;
