export type ExperimentWorkspaceStorageErrorCode =
  'idea_limit_reached' | 'metric_limit_reached' | 'parent_not_found' | 'idea_not_found';

export class ExperimentWorkspaceStorageError extends Error {
  constructor(readonly code: ExperimentWorkspaceStorageErrorCode) {
    super(code);
    this.name = 'ExperimentWorkspaceStorageError';
  }
}
