export interface DomainIssue {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export type DomainValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly DomainIssue[] };

export function validationResult(issues: readonly DomainIssue[]): DomainValidationResult {
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
