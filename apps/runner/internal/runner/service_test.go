package runner

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/events"
	"github.com/gosu-research/gosu/apps/runner/internal/job"
	"github.com/gosu-research/gosu/apps/runner/internal/podman"
	"github.com/gosu-research/gosu/apps/runner/internal/policy"
	"github.com/gosu-research/gosu/apps/runner/internal/store"
	"github.com/gosu-research/gosu/apps/runner/internal/testfixture"
)

type fakeExecutor struct {
	mu       sync.Mutex
	commands []podman.Command
	err      error
}

func (f *fakeExecutor) Run(_ context.Context, command podman.Command, _, _ io.Writer) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.commands = append(f.commands, command)
	return f.err
}

func TestSubmitExecutesAllowedSignedJobWithoutShell(t *testing.T) {
	now := time.Now().UTC()
	service, executor := fixtureService(t, now, true)
	envelope := testfixture.Envelope(now)
	raw, _ := json.Marshal(envelope)
	if err := service.Submit(context.Background(), raw); err != nil {
		t.Fatalf("Submit() error = %v", err)
	}
	service.Wait()
	record, err := service.Store.Get(envelope.Manifest.JobID)
	if err != nil || record.Status != job.StatusSucceeded {
		t.Fatalf("record = %+v, %v", record, err)
	}
	executor.mu.Lock()
	defer executor.mu.Unlock()
	if len(executor.commands) != 1 || executor.commands[0].Name != "podman" {
		t.Fatalf("commands = %+v", executor.commands)
	}
	if strings.Contains(strings.Join(executor.commands[0].Args, "\x00"), "sh\x00-c") {
		t.Fatalf("raw shell command generated: %+v", executor.commands[0])
	}
}

func TestSubmitPersistsPolicyRejectionWithoutExecution(t *testing.T) {
	now := time.Now().UTC()
	service, executor := fixtureService(t, now, false)
	envelope := testfixture.Envelope(now)
	raw, _ := json.Marshal(envelope)
	err := service.Submit(context.Background(), raw)
	if _, ok := err.(PolicyError); !ok {
		t.Fatalf("Submit() error = %T %v, want PolicyError", err, err)
	}
	record, getErr := service.Store.Get(envelope.Manifest.JobID)
	if getErr != nil || record.Status != job.StatusRejected || record.RejectionCode != "execution_disabled" {
		t.Fatalf("record = %+v, %v", record, getErr)
	}
	if len(executor.commands) != 0 {
		t.Fatalf("policy rejection executed commands: %+v", executor.commands)
	}
}

func TestSubmitRejectsTamperedSignatureBeforeExecution(t *testing.T) {
	now := time.Now().UTC()
	service, executor := fixtureService(t, now, true)
	envelope := testfixture.Envelope(now)
	envelope.Manifest.Command.Args[0] = "tampered.py"
	raw, _ := json.Marshal(envelope)
	err := service.Submit(context.Background(), raw)
	policyError, ok := err.(PolicyError)
	if !ok || policyError.Decision.Code != "manifest_hash_mismatch" {
		t.Fatalf("Submit() error = %T %v", err, err)
	}
	if len(executor.commands) != 0 {
		t.Fatalf("tampered manifest executed commands: %+v", executor.commands)
	}
}

func TestInvalidManifestDoesNotCreateUndeliverableSpoolEvent(t *testing.T) {
	service, _ := fixtureService(t, time.Now().UTC(), true)
	if err := service.Submit(context.Background(), []byte(`{"schemaVersion":1,"invalid":true}`)); err == nil {
		t.Fatal("Submit() error = nil, want invalid manifest rejection")
	}
	pending, err := service.Spool.Pending(100)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 0 {
		t.Fatalf("invalid manifest created spool events: %+v", pending)
	}
}

func TestOutboundEventMatchesSharedRunnerEventWireShape(t *testing.T) {
	occurredAt := time.Date(2026, time.August, 3, 1, 2, 3, 0, time.UTC)
	service := Service{RunnerID: "runner-test", ProjectID: "project-vision"}
	wire, err := service.toOutboundEvent(events.Event{
		Sequence: 7, EventID: "event-0007", JobID: "job-1",
		CampaignID: "campaign-1", TrialID: "trial-1", AttemptID: "attempt-1",
		Type: "job.running", At: occurredAt,
	})
	if err != nil {
		t.Fatalf("toOutboundEvent() error = %v", err)
	}
	encoded, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"type":"runner.event","projectId":"project-vision","runnerId":"runner-test","event":{"schemaVersion":1,"eventId":"event-0007","runnerId":"runner-test","campaignId":"campaign-1","trialId":"trial-1","attemptId":"attempt-1","sequence":7,"occurredAt":"2026-08-03T01:02:03Z","kind":"state","state":"running","previousState":"leased"}}`
	if string(encoded) != want {
		t.Fatalf("wire JSON = %s\nwant      = %s", encoded, want)
	}
}

func fixtureService(t *testing.T, now time.Time, enabled bool) (*Service, *fakeExecutor) {
	t.Helper()
	directory := t.TempDir()
	jobStore, err := store.Open(directory + "/store")
	if err != nil {
		t.Fatal(err)
	}
	spool, err := events.Open(directory + "/spool")
	if err != nil {
		t.Fatal(err)
	}
	executor := &fakeExecutor{}
	service := &Service{
		RunnerID: "runner-test", ProjectID: "project-test", StateDirectory: directory,
		Store: jobStore, Spool: spool,
		Podman: podman.Builder{Binary: "podman", MaxPIDs: 64}, Executor: executor,
		Policy: policy.Policy{
			ExecutionEnabled: enabled,
			Verifier: job.Verifier{PublicKeys: map[string]ed25519.PublicKey{
				testfixture.SigningKeyID: testfixture.PublicKey(),
			}},
			PolicyVersion: 1, PolicyHash: "local-policy-v1",
			AllowedImageDigests: []string{"sha256:" + strings.Repeat("0", 64)},
			AllowedExecutables:  []string{"python3"},
			MaxCPUs:             2, MaxMemoryMiB: 1024, MaxPIDs: 64, MaxRuntimeSeconds: 120,
		},
		StopGrace: time.Second,
		Now:       func() time.Time { return now },
	}
	return service, executor
}
