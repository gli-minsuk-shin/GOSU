# GOSU Linux runner skeleton

This directory contains a standalone Go module for a lab-operated Linux runner.
It exposes only a local health endpoint and initiates its control connection
outbound. Job execution is disabled by default.

## Safety model

- Job manifests are strict JSON and contain an executable plus argument array;
  shell executables and raw shell strings are rejected.
- Container images must be digest-pinned and match a local allowlist.
- Rootless Podman commands use `keep-id`, drop capabilities, disable privilege
  escalation, set resource limits, and force job networking to `none`. Network
  allowlists remain rejected until an enforceable egress adapter exists.
- GPU access is off by default. Operators must approve concrete NVIDIA CDI
  selectors; broad selectors such as `nvidia.com/gpu=all` are rejected.
- Inline secret-like environment keys are rejected. Manifests carry only
  approved Podman secret references, never secret values.
- The local job store atomically persists lease IDs, monotonic fencing tokens,
  idempotency keys, manifests, and lifecycle states.
- The append-only event spool assigns durable, contiguous sequence numbers and
  resends unacknowledged events after reconnect.

## Build and test

```text
cd apps/runner
go test ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/gosu-runner ./cmd/gosu-runner
```

Validate the sample without enabling execution:

```text
go run ./cmd/gosu-runner --validate-manifest ./examples/job-manifest.json
```

The sample uses an all-zero placeholder image digest and an `example` repository;
it is validation data, not an executable workload.

## Configuration

| Environment variable                | Default             | Purpose                                                                                        |
| ----------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `GOSU_RUNNER_ID`                    | `local-dev-runner`  | Stable runner identity                                                                         |
| `GOSU_RUNNER_PROJECT_ID`            | empty               | Project scope; required whenever the control WebSocket is configured                           |
| `GOSU_RUNNER_LISTEN_ADDR`           | `127.0.0.1:8088`    | Health listener                                                                                |
| `GOSU_RUNNER_STATE_DIR`             | `./var/gosu-runner` | Durable state, spool, workspaces, and logs                                                     |
| `GOSU_RUNNER_CONTROL_WS_URL`        | empty               | Outbound `ws://` or `wss://` endpoint; empty selects the disabled client                       |
| `GOSU_RUNNER_CONTROL_LAB_ID`        | empty               | Non-secret development lab header; required only for loopback `ws://` control                  |
| `GOSU_RUNNER_EXECUTION_ENABLED`     | `false`             | Explicit Podman execution opt-in                                                               |
| `GOSU_RUNNER_PODMAN_BINARY`         | `podman`            | Podman executable name/path                                                                    |
| `GOSU_RUNNER_ALLOWED_IMAGE_DIGESTS` | empty               | Comma-separated `sha256:` digest allowlist; required when execution is enabled                 |
| `GOSU_RUNNER_ALLOWED_EXECUTABLES`   | `python3,python`    | Exact in-container executable allowlist                                                        |
| `GOSU_RUNNER_ALLOWED_SECRET_REFS`   | empty               | Comma-separated Podman secret names that manifests may reference                               |
| `GOSU_RUNNER_ALLOW_JOB_NETWORK`     | `false`             | Reserved; `true` is rejected until an enforceable egress adapter exists                        |
| `GOSU_RUNNER_ALLOWED_NETWORK_HOSTS` | empty               | Reserved; non-empty values are rejected until the egress adapter exists                        |
| `GOSU_RUNNER_SIGNING_PUBLIC_KEYS`   | empty               | Comma-separated `key-id=base64-ed25519-public-key` entries; required when execution is enabled |
| `GOSU_RUNNER_POLICY_VERSION`        | `1`                 | Exact signed manifest policy version                                                           |
| `GOSU_RUNNER_POLICY_HASH`           | `local-policy-v1`   | Exact signed manifest policy hash                                                              |
| `GOSU_RUNNER_MAX_CPUS`              | `4`                 | Per-job CPU cap                                                                                |
| `GOSU_RUNNER_MAX_MEMORY_MB`         | `8192`              | Per-job memory cap                                                                             |
| `GOSU_RUNNER_MAX_PIDS`              | `512`               | Per-job PID cap                                                                                |
| `GOSU_RUNNER_GPU_DEVICES`           | empty               | Ordered, comma-separated concrete NVIDIA CDI selectors; empty disables GPU access              |
| `GOSU_RUNNER_MAX_GPU_MEMORY_MIB`    | `0`                 | Declared per-job GPU-memory admission cap; must be positive when GPU devices are configured    |
| `GOSU_RUNNER_MAX_RUNTIME_SECONDS`   | `7200`              | Per-job wall-clock cap                                                                         |
| `GOSU_RUNNER_STOP_GRACE_SECONDS`    | `15`                | Graceful Podman stop window                                                                    |

`GET http://127.0.0.1:8088/healthz` reports runner, control connection, execution,
and event-spool status without exposing manifests or configuration values.

For a GPU job, the signed manifest must request no more devices than the CDI
allowlist, declare positive GPU memory within the configured cap, and keep
`gpuCount × timeoutSeconds / 3600` within its immutable objective GPU-hour
budget. The runner passes only the selected concrete devices as structured
`podman run --device <selector>` arguments. GPU-memory admission is a scheduling
guardrail, not a hard VRAM partition; use hardware or MIG partitioning when
strict VRAM isolation is required.

## Control messages

When configured, the client connects outbound and accepts four JSON envelopes:

- `job.submit` with a nested `manifest`
- `job.stop` or `job.kill` with `job_id`, `lease_id`, and `fence_token`
- `events.ack` with the highest durably received `sequence`

Each connection starts with a project-scoped `runner.hello` and protocol version
`v1`. Durable internal lifecycle entries are translated to the shared wire
contract:

```json
{
  "type": "runner.event",
  "projectId": "project-fixture",
  "runnerId": "runner-fixture",
  "event": {
    "schemaVersion": 1,
    "eventId": "event-00000000000000000001",
    "runnerId": "runner-fixture",
    "campaignId": "campaign-fixture",
    "trialId": "trial-fixture",
    "attemptId": "attempt-fixture",
    "sequence": 1,
    "occurredAt": "2026-08-03T00:00:00Z",
    "kind": "state",
    "state": "leased",
    "previousState": "pending"
  }
}
```

Delivery is at least once; consumers deduplicate with `event.eventId` or
`event.sequence`, and `events.ack.sequence` acknowledges that same durable
sequence.

Plaintext `ws://` is accepted only on loopback for local development. In that
mode the runner sends explicit non-secret `x-gosu-client-kind: runner`,
`x-gosu-lab`, `x-gosu-sub`, and `x-gosu-role: project_lead` headers.
Non-loopback control requires `wss://`;
production workload identity and mTLS termination are follow-up deployment
work and are not supplied by the development headers.

`Stop` is graceful: queued jobs become `stopped`, while running jobs enter
`stop_requested` and call `podman stop --time <grace>`. `Kill` dominates Stop:
queued jobs become `killed`, while running or stopping jobs enter
`kill_requested` and call `podman kill`. Repeated requests are idempotent. Only
the current, unexpired lease and exact fence token can issue remote controls.

## Deliberate skeleton boundaries

The execution path expects the immutable Git revision to already be materialized
under `STATE_DIR/workspaces/<job_id>`. Repository checkout, Git credentials,
artifact upload, production mTLS workload identity, enforced outbound network
allowlists, and post-run branch commit are follow-up adapters. They must preserve
the structured command contract and must not place credentials in manifests,
URLs, events, or process arguments.

Run only one runner process per state directory. Cross-process file locking and
active-container reconciliation after a host crash are not part of this skeleton.
