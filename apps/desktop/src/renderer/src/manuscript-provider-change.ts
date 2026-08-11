import type { ManuscriptWorkspaceConnection } from '../../shared/manuscript-workspace-contracts';

export type ManuscriptProviderChangeState =
  'not_checked' | 'baseline_required' | 'unchanged' | 'provider_changed' | 'check_failed';

export type ManuscriptProviderChangeAssessment = Readonly<{
  state: ManuscriptProviderChangeState;
  title: string;
  detail: string;
}>;

export function activeManuscriptBindingCheckpoint(connection: ManuscriptWorkspaceConnection) {
  return connection.lastCheckpoint?.bindingId === connection.binding.bindingId
    ? connection.lastCheckpoint
    : null;
}

export function deriveManuscriptProviderChange(
  connection: ManuscriptWorkspaceConnection,
  checkFailed = false,
): ManuscriptProviderChangeAssessment {
  if (checkFailed) {
    return {
      state: 'check_failed',
      title: "Couldn't check Overleaf",
      detail:
        'The previous revision result may be stale. No remote files were changed by this check.',
    };
  }

  if (!connection.lastObservedAt || !connection.lastObservedProviderRevision) {
    return {
      state: 'not_checked',
      title: 'Overleaf has not been checked',
      detail: 'Run the read-only revision check before capturing a comparison baseline.',
    };
  }

  const checkpoint = activeManuscriptBindingCheckpoint(connection);
  if (!checkpoint?.providerRevision) {
    return {
      state: 'baseline_required',
      title: 'Baseline not captured',
      detail:
        'Capture an inbound checkpoint for this connection before GOSU can detect later Overleaf revision changes.',
    };
  }

  if (connection.lastObservedProviderRevision === checkpoint.providerRevision) {
    return {
      state: 'unchanged',
      title: 'No new Overleaf Git revision',
      detail:
        'The saved Git revision matches this connection’s captured checkpoint. Unsaved live edits and file-level conflicts are not evaluated.',
    };
  }

  return {
    state: 'provider_changed',
    title: 'Overleaf Git revision changed',
    detail:
      'A new saved Overleaf revision was observed since the checkpoint. Source-level conflict has not been evaluated because GOSU has not imported a common source for three-way comparison.',
  };
}
