// Cold Mail can need discovery + reading; Calendar can need helper compilation + reading.
// Scoped overrides only: routine-design and zero-tool analysis retain their existing budgets.
export const ASSISTANT_TOOL_TIMEOUTS = {
  list_projects: 30_000,
  read_project: 30_000,
  read_model_lab: 30_000,
  remember_project_context: 120_000,
  request_project_work: 120_000,
  search_email: 150_000,
  read_calendar: 210_000,
  search_papers: 75_000,
  read_public_paper: 150_000,
  save_paper_summary: 240_000,
  search_briefing_history: 30_000,
  read_briefing_history: 30_000,
  search_saved_papers: 30_000,
  read_saved_paper: 30_000,
} as const;
export const ASSISTANT_TURN_TIMEOUT_MS = 360_000;
const categories = {
  timeout: new Set([
    'mail_timeout_account',
    'mail_timeout_mailbox',
    'mail_timeout_metadata',
    'mail_timeout_body',
    'calendar_timeout',
    'calendar_bridge_build_timeout',
    'source_timeout',
  ]),
  cancelled: new Set(['source_cancelled', 'assistant_tool_aborted']),
  permission: new Set([
    'assistant_project_permission_required',
    'mail_permission_denied',
    'calendar_permission_required',
    'assistant_mail_permission_required',
    'assistant_calendar_permission_required',
    'assistant_private_ai_required',
    'assistant_client_required',
    'assistant_settings_changed',
    'assistant_mail_scope_required',
    'mail_scope_required',
    'briefing_native_consent_denied',
    'briefing_native_consent_unavailable',
  ]),
  invalid_request: new Set([
    'mail_search_range_invalid',
    'calendar_range_invalid',
    'calendar_request_invalid',
    'assistant_tool_request_invalid',
  ]),
  unavailable: new Set([
    'mail_search_turn_limit',
    'mail_search_index_required',
    'mail_search_too_broad',
    'mail_account_refresh_required',
    'mail_grant_limit',
    'mail_invalid_response',
    'mail_macos_required',
    'mail_response_limit',
    'mail_scope_response_invalid',
    'mail_unavailable',
    'calendar_scope_missing',
    'calendar_scope_invalid',
    'calendar_macos_required',
    'calendar_path_unsafe',
    'calendar_bridge_build_failed',
    'calendar_bridge_sign_failed',
    'calendar_response_invalid',
    'calendar_response_limit',
    'calendar_unavailable',
    'source_rate_limited',
    'assistant_tool_unavailable',
    'assistant_tool_response_limit',
  ]),
};

/** Never pass private source text, native stderr or arbitrary error strings to the model. */
export function briefingToolFailure(error: unknown) {
  const receipt = sourceFailureReceipt(error);
  if (error instanceof SourceRateLimitError || error instanceof SourceReadError)
    return {
      error: error.message,
      category:
        error instanceof SourceRateLimitError
          ? 'unavailable'
          : error.phase === 'timeout'
            ? 'timeout'
            : 'unavailable',
      retryable: false,
      source: receipt,
      guidance:
        error instanceof SourceRateLimitError
          ? error.phase === 'cooldown'
            ? 'GOSU did not send this request: it is waiting after a prior HTTP 429. This is not a newly observed server rejection. Respect retryAt; use independent public publishers instead.'
            : 'An upstream HTTP response or reported rate limit prevented this source read. Respect retryAt; do not repeatedly retry this host. Continue with independent public publisher sources.'
          : 'GOSU source read failed or reached its local deadline. A timeout is not evidence of HTTP 429 or an IP ban. Continue with independent public publisher sources; do not infer missing permission.',
    };
  const raw = error instanceof Error ? error.message : '';
  if (raw === 'mail_search_outside_scope' || raw === 'mail_search_account_not_connected')
    return {
      error: raw,
      category: 'permission',
      retryable: false,
      guidance:
        raw === 'mail_search_outside_scope'
          ? 'The requested window lies wholly in the future, so nothing was searched. Ask for a date range that has already passed.'
          : 'The receiving account did not match a connected approved account. Explain the account scope mismatch; do not claim the message is absent or search another account instead.',
    };
  const candidate =
    error instanceof Error && error.name === 'ZodError' ? 'assistant_tool_request_invalid' : raw;
  const matched = Object.entries(categories).find(([, codes]) => codes.has(candidate));
  const category = matched?.[0] ?? 'unavailable';
  const code = matched ? candidate : 'assistant_tool_failed';
  return {
    error: code,
    category,
    retryable: false,
    guidance:
      category === 'permission'
        ? 'Explain the specific denied permission or changed approved scope. Do not grant access or widen scope.'
        : category === 'invalid_request'
          ? 'Correct only the invalid tool arguments, keeping the approved scope.'
          : 'This is a source execution failure, NOT evidence of missing permission. Do not ask the user to reauthorize or repeat this source read in this turn. Report the failed source and continue with other available sources; failure is not an empty result.',
  };
}
import { sourceFailureReceipt, SourceRateLimitError, SourceReadError } from './live-public-http';
