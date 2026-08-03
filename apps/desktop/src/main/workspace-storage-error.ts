export class WorkspaceDataRecoveryError extends Error {
  constructor() {
    super('workspace_data_requires_recovery');
    this.name = 'WorkspaceDataRecoveryError';
  }
}
