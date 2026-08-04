export const SSH_IPC_CHANNELS = {
  listConnections: 'gosu:ssh:list-connections',
  createConnection: 'gosu:ssh:create-connection',
  updateConnection: 'gosu:ssh:update-connection',
  removeConnection: 'gosu:ssh:remove-connection',
  testConnection: 'gosu:ssh:test-connection',
  resolveApproval: 'gosu:ssh:resolve-approval',
  cancelScope: 'gosu:ssh:cancel-scope',
  event: 'gosu:ssh:event',
} as const;
