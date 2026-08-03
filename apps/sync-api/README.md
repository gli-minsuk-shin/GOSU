# GOSU Sync API

The Sync API is the hosted collaboration boundary. It is designed to persist collaboration
metadata only, never repository files, Obsidian content, Zotero PDFs, raw runner logs, metric
series, checkpoints, artifacts, hidden tool payloads, or credentials.

## Runnable development service

The current Nest application always injects `SyncStore`, a deterministic in-memory development
repository. It includes seeded demo data unless `SEED_DEMO=false`, and all state is lost when the
process exits. `GOSU_PERSISTENCE=postgres` is reserved configuration and does not currently change
that runtime behavior.

```bash
pnpm --filter @gosu/sync-api dev
curl http://127.0.0.1:4000/health
curl \
  -H 'x-gosu-lab: lab-demo' \
  -H 'x-gosu-sub: user-demo' \
  -H 'x-gosu-role: owner' \
  http://127.0.0.1:4000/v1/bootstrap
```

Development authentication requires all three `x-gosu-*` headers shown above; it never supplies a
default identity or role. It is rejected whenever `NODE_ENV=production`; never expose development
mode outside a local machine.

Set `GOSU_AUTH_MODE=oidc` to verify an already-issued GOSU bearer JWT against
`GOSU_OIDC_ISSUER` and `GOSU_OIDC_AUDIENCE`. The token must include `gosu:lab` and `gosu:role`
claims plus a standard expiration (`exp`). Remote JWKS resolvers are cached per issuer. This
verifier is not yet the Google/Apple PKCE login, account-linking, invitation, or GOSU
session-issuing flow described in the product plan.

## PostgreSQL adapter boundary

`PostgresSyncStore` and `db/001_initial.sql` provide the production persistence foundation:

- `(issuer, subject)` identities, lab memberships, projects, work items, visible chat, and run
  summaries;
- forced row-level security policies, including outbox and idempotency rows, using
  transaction-local lab, project, and actor context;
- optimistic entity versions and idempotency-key conflict detection; and
- transactional audit and outbox records with payload checks that reject common secret and local
  research-data fields.

For adapter development, start the local services and apply the migration explicitly:

```bash
docker compose up -d postgres redis
set -a
. ./.env
set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/sync-api/db/001_initial.sql
pnpm --filter @gosu/sync-api test
```

Applying the migration does not make the HTTP controllers use PostgreSQL. Before production, wire
the adapter into Nest lifecycle and controllers, run migrations through a deployment-managed role,
add an outbox publisher and Redis coordination, and exercise the real database with integration and
recovery tests. `createPostgresRuntime()` is an adapter construction helper, not an application
bootstrap hook.

## Event relay and data retention

`/v1/events` sends lab-filtered in-process SSE events. `/v1/relay` checks the exact browser Origin
against `GOSU_ALLOWED_ORIGINS`, authenticates the handshake, authorizes project subscriptions, and
relays events only to viewers of the same project. An originless native connection must declare
`x-gosu-client-kind: runner`; it cannot subscribe as a viewer and still must authenticate. Payloads
are capped at 128 KiB, per-message compression is disabled, and slow viewers are disconnected once
their send buffer exceeds 512 KiB.

Runner publication uses the shared `@gosu/contracts` `RunnerEventV1` inside this strict transport
envelope:

```json
{
  "type": "runner.event",
  "projectId": "project-fixture",
  "runnerId": "runner-fixture",
  "event": {
    "schemaVersion": 1,
    "eventId": "event-fixture",
    "runnerId": "runner-fixture",
    "campaignId": "campaign-fixture",
    "trialId": "trial-fixture",
    "attemptId": "attempt-fixture",
    "sequence": 3,
    "occurredAt": "2026-08-03T08:00:00.000Z",
    "kind": "state",
    "state": "running"
  }
}
```

The relay answers accepted and exact duplicate events with `events.ack` and the durable event
sequence, never rebroadcasts duplicates or stale sequences, and isolates sequence projection by
attempt. Raw logs, resource samples, artifact references, and metric series remain relay-only.
Only metric events explicitly marked `isSummary: true` enter the development run summary.

Runner mTLS is not terminated or verified by this Node process. A production ingress must require
and validate runner client certificates, translate the verified identity into a short-lived service
credential, and prevent clients from spoofing forwarded identity headers. Until that path exists,
do not expose the runner publish endpoint or WebSocket relay to an untrusted network.

## Production checklist

Before deploying this service:

1. replace development auth with the complete OIDC/PKCE and membership session flow;
2. wire and migrate PostgreSQL, Redis, outbox publication, shutdown, and recovery behavior;
3. enforce TLS, runner mTLS, trusted-proxy configuration, origin policy, and rate/body limits at
   ingress;
4. provision least-privilege database and deployment roles and verify row-level security under
   those roles; and
5. verify that logs, traces, crash reports, and backups cannot capture local-only payloads or
   credentials.
