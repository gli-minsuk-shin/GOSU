# Security Policy

GOSU is security-sensitive software: it connects to source control, local files, AI providers,
and remote compute. Please report suspected vulnerabilities privately.

## Supported versions

GOSU is pre-release software. Only the latest revision on `main` receives security fixes until a
versioned release policy is published.

| Version                 | Supported |
| ----------------------- | --------- |
| Latest `main`           | Yes       |
| Older commits and forks | No        |

## Reporting a vulnerability

Do **not** open a public issue or pull request containing exploit details, credentials, private
research content, or logs.

Use GitHub's private vulnerability report for this repository:

<https://github.com/gli-minsuk-shin/GOSU/security/advisories/new>

If the private reporting form is unavailable, contact the repository owner through an existing
private channel and request a security contact before sharing details. Do not fall back to a public
issue.

Include only the minimum information necessary to reproduce the issue:

- affected revision and component;
- impact and the trust boundary crossed;
- deterministic reproduction steps or a minimal proof of concept;
- whether credentials, research data, or costly compute may be exposed; and
- any suggested mitigation.

Remove real secrets and personal or unpublished research data before submitting. The maintainers
will coordinate validation, remediation, disclosure timing, and credit through the private report.

## If a secret is exposed

Treat every committed or logged secret as compromised, even if the commit is later removed.
Immediately revoke or rotate it at the issuing provider, stop affected runners, and report the
incident privately. Rewriting Git history is not a substitute for revocation.

## Security expectations

- Credentials belong in the macOS Keychain or runner secret store, never in source, `.env.example`,
  sync events, job manifests, logs, crash reports, or telemetry.
- Hosted services must reject cross-lab and cross-project access at query, command, search, event,
  and streaming boundaries.
- Runner jobs must remain non-root, capability-dropped, resource-limited, read-only, and
  network-denied unless a signed policy explicitly grants narrower access.
- Electron renderer code must not receive direct Node.js or privileged local APIs.
- Automated changes must preserve human approval gates for protected branches, evidence,
  security-sensitive policy, and external exports.

## Pre-release operational limitations

Several production controls are architectural requirements or isolated adapters, not completed
deployment guarantees in this bootstrap:

- The Sync API runs with an in-memory store. Its PostgreSQL schema and adapter are not yet wired to
  the HTTP/WebSocket runtime, migrations, outbox delivery, or Redis coordination.
- Development authentication trusts local `x-gosu-*` headers and must never be exposed to an
  untrusted network. The code forbids this mode when `NODE_ENV=production`.
- OIDC mode verifies an existing GOSU JWT, but Google/Apple PKCE, invitation membership, token
  issuance, and account-linking flows are not complete.
- Runner mTLS must be enforced by a trusted ingress; the Node relay does not itself terminate or
  verify client certificates.
- macOS packaging configuration is present, but release signing, notarization, update delivery, and
  clean-machine validation are not complete.

Until those controls are implemented and independently verified, use synthetic data and local-only
credentials, keep network listeners bound to loopback, and do not use GOSU for unattended or costly
production experiments.

Operational details that would materially aid exploitation should stay in private security
documentation rather than this public repository.
