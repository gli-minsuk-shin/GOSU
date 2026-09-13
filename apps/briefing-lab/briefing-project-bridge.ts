export type ProjectBridge = (
  action: 'list' | 'read' | 'remember' | 'request' | 'model-lab',
  projectId: string,
  text: string,
  signal: AbortSignal,
  recheck?: () => Promise<void>,
) => Promise<unknown>;
