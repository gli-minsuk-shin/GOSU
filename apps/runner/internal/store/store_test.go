package store

import (
	"errors"
	"testing"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/job"
	"github.com/gosu-research/gosu/apps/runner/internal/testfixture"
)

func TestStorePersistsIdempotencyAndFencing(t *testing.T) {
	directory := t.TempDir()
	now := time.Now().UTC()
	envelope := envelopeFixture(now, 1, "submit-one")
	jobStore, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	first, err := jobStore.Accept(envelope, now)
	if err != nil || first.Duplicate {
		t.Fatalf("first Accept() = %+v, %v", first, err)
	}
	duplicate, err := jobStore.Accept(envelope, now.Add(time.Second))
	if err != nil || !duplicate.Duplicate {
		t.Fatalf("duplicate Accept() = %+v, %v", duplicate, err)
	}

	conflict := envelope
	conflict.IdempotencyKey = "submit-conflict"
	conflict.Manifest.Command.Args = []string{"different.py"}
	testfixture.Sign(&conflict.Manifest)
	if _, err := jobStore.Accept(conflict, now); !errors.Is(err, ErrFenceConflict) {
		t.Fatalf("same-fence error = %v, want ErrFenceConflict", err)
	}

	replacement := envelopeFixture(now, 2, "submit-two")
	replaced, err := jobStore.Accept(replacement, now.Add(2*time.Second))
	if err != nil || replaced.Superseded == nil {
		t.Fatalf("replacement Accept() = %+v, %v", replaced, err)
	}
	if _, err := jobStore.Accept(envelope, now.Add(3*time.Second)); !errors.Is(err, ErrStaleFence) {
		t.Fatalf("stale-fence error = %v, want ErrStaleFence", err)
	}

	reopened, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	record, err := reopened.Get(envelope.Manifest.JobID)
	if err != nil || record.Envelope.Lease.FenceToken != 2 {
		t.Fatalf("reopened record = %+v, %v", record, err)
	}
}

func TestStoreStopKillAndLeaseChecks(t *testing.T) {
	now := time.Now().UTC()
	jobStore, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	envelope := envelopeFixture(now, 1, "submit-running")
	jobID := envelope.Manifest.JobID
	if _, err := jobStore.Accept(envelope, now); err != nil {
		t.Fatal(err)
	}
	if _, err := jobStore.Transition(jobID, envelope.Lease.ID, 1, job.StatusQueued, now); err != nil {
		t.Fatal(err)
	}
	if _, err := jobStore.Transition(jobID, envelope.Lease.ID, 1, job.StatusRunning, now); err != nil {
		t.Fatal(err)
	}
	stopping, err := jobStore.RequestStop(jobID, envelope.Lease.ID, 1, now)
	if err != nil || stopping.Status != job.StatusStopRequested {
		t.Fatalf("RequestStop() = %+v, %v", stopping, err)
	}
	killing, err := jobStore.RequestKill(jobID, envelope.Lease.ID, 1, now)
	if err != nil || killing.Status != job.StatusKillRequested {
		t.Fatalf("RequestKill() = %+v, %v", killing, err)
	}
	if _, err := jobStore.RequestKill(jobID, "wrong-lease", 1, now); !errors.Is(err, ErrLeaseMismatch) {
		t.Fatalf("lease mismatch error = %v", err)
	}
	if _, err := jobStore.RequestKill(jobID, envelope.Lease.ID, 1, envelope.Lease.ExpiresAt); !errors.Is(err, ErrLeaseExpired) {
		t.Fatalf("expired lease error = %v", err)
	}
}

func TestStoreRejectsReusedIdempotencyKey(t *testing.T) {
	now := time.Now().UTC()
	jobStore, _ := Open(t.TempDir())
	first := envelopeFixture(now, 1, "same-key")
	if _, err := jobStore.Accept(first, now); err != nil {
		t.Fatal(err)
	}
	second := envelopeFixture(now, 1, "same-key")
	second.Manifest.JobID = "different-job"
	second.Lease.ID = "different-lease"
	testfixture.Sign(&second.Manifest)
	if _, err := jobStore.Accept(second, now); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("error = %v, want ErrIdempotencyConflict", err)
	}
}

func envelopeFixture(now time.Time, fence uint64, idempotency string) job.Envelope {
	envelope := testfixture.Envelope(now)
	envelope.Lease.FenceToken = fence
	envelope.IdempotencyKey = idempotency
	return envelope
}
