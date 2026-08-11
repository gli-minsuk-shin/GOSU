export type ExperimentWorkspaceStorageErrorCode =
  | 'idea_limit_reached'
  | 'metric_limit_reached'
  | 'parent_not_found'
  | 'idea_not_found'
  | 'logging_template_conflict'
  | 'logging_template_limit_reached'
  | 'run_not_found'
  | 'run_conflict'
  | 'run_limit_reached'
  | 'run_log_source_conflict'
  | 'run_execution_binding_conflict'
  | 'run_execution_intent_conflict';

export class ExperimentWorkspaceStorageError extends Error {
  constructor(readonly code: ExperimentWorkspaceStorageErrorCode) {
    super(code);
    this.name = 'ExperimentWorkspaceStorageError';
  }
}
