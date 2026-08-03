package events

import (
	"testing"
	"time"
)

func TestSpoolPersistsSequenceAndAcknowledgement(t *testing.T) {
	directory := t.TempDir()
	spool, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	first, err := spool.Append("job.queued", "job-1", map[string]string{"state": "queued"}, time.Now())
	if err != nil || first.Sequence != 1 {
		t.Fatalf("first Append() = %+v, %v", first, err)
	}
	second, err := spool.Append("job.running", "job-1", nil, time.Now())
	if err != nil || second.Sequence != 2 {
		t.Fatalf("second Append() = %+v, %v", second, err)
	}
	if err := spool.Ack(1); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	pending, err := reopened.Pending(100)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].Sequence != 2 {
		t.Fatalf("pending = %+v", pending)
	}
	third, err := reopened.Append("job.succeeded", "job-1", nil, time.Now())
	if err != nil || third.Sequence != 3 {
		t.Fatalf("third Append() = %+v, %v", third, err)
	}
	if err := reopened.Ack(4); err == nil {
		t.Fatal("Ack() error = nil for future sequence")
	}
}

func TestPendingHonorsLimit(t *testing.T) {
	spool, _ := Open(t.TempDir())
	for index := 0; index < 3; index++ {
		if _, err := spool.Append("test", "", nil, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	pending, err := spool.Pending(2)
	if err != nil || len(pending) != 2 {
		t.Fatalf("Pending() = %d events, %v", len(pending), err)
	}
}

func TestAppendJobPersistsTrialLineage(t *testing.T) {
	spool, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want := JobMetadata{
		JobID: "job-1", CampaignID: "campaign-1", TrialID: "trial-1", AttemptID: "attempt-1",
	}
	if _, err := spool.AppendJob("job.running", want, nil, time.Now()); err != nil {
		t.Fatal(err)
	}
	pending, err := spool.Pending(1)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 1 || pending[0].JobID != want.JobID || pending[0].CampaignID != want.CampaignID || pending[0].TrialID != want.TrialID || pending[0].AttemptID != want.AttemptID {
		t.Fatalf("pending = %+v, want lineage %+v", pending, want)
	}
}
