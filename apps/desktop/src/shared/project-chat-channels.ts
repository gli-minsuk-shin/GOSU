export const PROJECT_CHAT_IPC_CHANNELS = {
  snapshot: 'gosu:project-chat:snapshot',
  listSessions: 'gosu:project-chat:list-sessions',
  createSession: 'gosu:project-chat:create-session',
  branchSession: 'gosu:project-chat:branch-session',
  renameSession: 'gosu:project-chat:rename-session',
  updateProfile: 'gosu:project-chat:update-profile',
  send: 'gosu:project-chat:send',
  cancel: 'gosu:project-chat:cancel',
  revokeSsh: 'gosu:project-chat:revoke-ssh',
  applyAction: 'gosu:project-chat:apply-action',
  event: 'gosu:project-chat:event',
} as const;
