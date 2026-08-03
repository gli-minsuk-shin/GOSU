export const WORKSPACE_IPC_CHANNELS = {
  snapshot: 'gosu:workspace:snapshot',
  pendingSummary: 'gosu:workspace:pending-summary',
  createProject: 'gosu:workspace:create-project',
  createTask: 'gosu:workspace:create-task',
  updateTask: 'gosu:workspace:update-task',
  saveObjective: 'gosu:workspace:save-objective',
  lockObjective: 'gosu:workspace:lock-objective',
  startObjectiveVersion: 'gosu:workspace:start-objective-version',
} as const;
