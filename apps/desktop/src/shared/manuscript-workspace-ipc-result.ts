export const MANUSCRIPT_WORKSPACE_IPC_ERROR_CODES = [
  'project_not_found',
  'project_archived',
  'project_trashed',
  'manuscript_not_found',
  'manuscript_conflict',
  'manuscript_limit_reached',
  'manuscript_delete_not_allowed',
  'manuscript_binding_not_found',
  'manuscript_binding_conflict',
  'manuscript_binding_exists',
  'manuscript_provider_unavailable',
  'manuscript_provider_revision_required',
  'manuscript_checkpoint_not_found',
  'manuscript_checkpoint_file_not_found',
  'manuscript_checkpoint_file_not_text',
  'manuscript_checkpoint_tree_unsafe',
  'manuscript_pdf_compiler_unavailable',
  'manuscript_pdf_compile_failed',
  'manuscript_pdf_too_large',
  'manuscript_pdf_invalid',
  'manuscript_pdf_cache_failed',
  'manuscript_pdf_artifact_not_found',
  'manuscript_pdf_export_failed',
  'manuscript_pdf_open_failed',
  'overleaf_git_url_invalid',
  'overleaf_git_auth_required',
  'overleaf_git_project_not_found',
  'overleaf_git_default_branch_missing',
  'overleaf_git_remote_rewritten',
  'overleaf_git_root_document_missing',
  'overleaf_git_checkpoint_too_large',
  'overleaf_keychain_unavailable',
  'overleaf_token_invalid',
  'invalid_manuscript_workspace_input',
  'manuscript_workspace_unavailable',
] as const;

export type ManuscriptWorkspaceIpcErrorCode = (typeof MANUSCRIPT_WORKSPACE_IPC_ERROR_CODES)[number];

export type ManuscriptWorkspaceIpcResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ code: ManuscriptWorkspaceIpcErrorCode }> }>;

const knownErrorCodes = new Set<string>(MANUSCRIPT_WORKSPACE_IPC_ERROR_CODES);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unwrapManuscriptWorkspaceIpcResult<T>(result: unknown): T {
  if (record(result) && result.ok === true && 'value' in result) return result.value as T;
  if (
    record(result) &&
    result.ok === false &&
    record(result.error) &&
    typeof result.error.code === 'string' &&
    knownErrorCodes.has(result.error.code)
  ) {
    throw new Error(result.error.code);
  }
  throw new Error('manuscript_workspace_unavailable');
}
