package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/job"
)

var (
	ErrJobNotFound         = errors.New("job not found")
	ErrIdempotencyConflict = errors.New("idempotency key conflict")
	ErrStaleFence          = errors.New("stale fence token")
	ErrFenceConflict       = errors.New("fence token conflict")
	ErrLeaseMismatch       = errors.New("lease mismatch")
	ErrLeaseExpired        = errors.New("lease expired")
)

type Record struct {
	Envelope      job.Envelope `json:"envelope"`
	ManifestHash  string       `json:"manifest_hash"`
	Status        job.Status   `json:"status"`
	RejectionCode string       `json:"rejection_code,omitempty"`
	RejectionText string       `json:"rejection_text,omitempty"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
}

type AcceptResult struct {
	Record     Record
	Duplicate  bool
	Superseded *Record
}

type idempotencyRecord struct {
	JobID        string `json:"job_id"`
	FenceToken   uint64 `json:"fence_token"`
	ManifestHash string `json:"manifest_hash"`
}

type diskState struct {
	Version     int                          `json:"version"`
	Jobs        map[string]Record            `json:"jobs"`
	Idempotency map[string]idempotencyRecord `json:"idempotency"`
}

type Store struct {
	mu       sync.RWMutex
	filename string
	state    diskState
}

func Open(directory string) (*Store, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create state directory: %w", err)
	}
	store := &Store{
		filename: filepath.Join(directory, "jobs.json"),
		state: diskState{
			Version:     1,
			Jobs:        make(map[string]Record),
			Idempotency: make(map[string]idempotencyRecord),
		},
	}
	data, err := os.ReadFile(store.filename)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read job store: %w", err)
	}
	if err := json.Unmarshal(data, &store.state); err != nil {
		return nil, fmt.Errorf("decode job store: %w", err)
	}
	if store.state.Version != 1 {
		return nil, fmt.Errorf("unsupported job store version %d", store.state.Version)
	}
	if store.state.Jobs == nil {
		store.state.Jobs = make(map[string]Record)
	}
	if store.state.Idempotency == nil {
		store.state.Idempotency = make(map[string]idempotencyRecord)
	}
	return store, nil
}

func (s *Store) Accept(envelope job.Envelope, now time.Time) (AcceptResult, error) {
	return s.record(envelope, job.StatusAccepted, "", "", now)
}

func (s *Store) Reject(envelope job.Envelope, code, reason string, now time.Time) (AcceptResult, error) {
	return s.record(envelope, job.StatusRejected, code, reason, now)
}

func (s *Store) record(envelope job.Envelope, status job.Status, code, reason string, now time.Time) (AcceptResult, error) {
	digest, err := envelope.Digest()
	if err != nil {
		return AcceptResult{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	jobID := envelope.Manifest.JobID
	if existing, ok := s.state.Jobs[jobID]; ok {
		if envelope.Lease.FenceToken < existing.Envelope.Lease.FenceToken {
			return AcceptResult{}, fmt.Errorf("%w: current=%d received=%d", ErrStaleFence, existing.Envelope.Lease.FenceToken, envelope.Lease.FenceToken)
		}
		if envelope.Lease.FenceToken == existing.Envelope.Lease.FenceToken {
			if existing.ManifestHash == digest && existing.Envelope.IdempotencyKey == envelope.IdempotencyKey {
				return AcceptResult{Record: existing, Duplicate: true}, nil
			}
			return AcceptResult{}, fmt.Errorf("%w: job %s already has fence %d", ErrFenceConflict, jobID, envelope.Lease.FenceToken)
		}
	}
	if existing, ok := s.state.Idempotency[envelope.IdempotencyKey]; ok {
		if existing.JobID == jobID && existing.FenceToken == envelope.Lease.FenceToken && existing.ManifestHash == digest {
			record := s.state.Jobs[jobID]
			return AcceptResult{Record: record, Duplicate: true}, nil
		}
		return AcceptResult{}, fmt.Errorf("%w: key %s is already used", ErrIdempotencyConflict, envelope.IdempotencyKey)
	}

	next := cloneState(s.state)
	var superseded *Record
	if current, ok := next.Jobs[jobID]; ok {
		copy := current
		superseded = &copy
	}
	record := Record{
		Envelope:      envelope,
		ManifestHash:  digest,
		Status:        status,
		RejectionCode: code,
		RejectionText: reason,
		CreatedAt:     now.UTC(),
		UpdatedAt:     now.UTC(),
	}
	next.Jobs[jobID] = record
	next.Idempotency[envelope.IdempotencyKey] = idempotencyRecord{
		JobID: jobID, FenceToken: envelope.Lease.FenceToken, ManifestHash: digest,
	}
	if err := persist(s.filename, next); err != nil {
		return AcceptResult{}, err
	}
	s.state = next
	return AcceptResult{Record: record, Superseded: superseded}, nil
}

func (s *Store) Get(jobID string) (Record, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.state.Jobs[jobID]
	if !ok {
		return Record{}, ErrJobNotFound
	}
	return record, nil
}

func (s *Store) List() []Record {
	s.mu.RLock()
	defer s.mu.RUnlock()
	records := make([]Record, 0, len(s.state.Jobs))
	for _, record := range s.state.Jobs {
		records = append(records, record)
	}
	return records
}

// Transition applies a local lifecycle update. It requires the exact current
// lease/fence but intentionally permits completion after lease expiry.
func (s *Store) Transition(jobID, leaseID string, fenceToken uint64, target job.Status, now time.Time) (Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, err := currentRecord(s.state, jobID, leaseID, fenceToken, now, false)
	if err != nil {
		return Record{}, err
	}
	if !job.CanTransition(record.Status, target) {
		return Record{}, fmt.Errorf("invalid job transition %s -> %s", record.Status, target)
	}
	if record.Status == target {
		return record, nil
	}
	record.Status = target
	record.UpdatedAt = now.UTC()
	next := cloneState(s.state)
	next.Jobs[jobID] = record
	if err := persist(s.filename, next); err != nil {
		return Record{}, err
	}
	s.state = next
	return record, nil
}

func (s *Store) RequestStop(jobID, leaseID string, fenceToken uint64, now time.Time) (Record, error) {
	return s.remoteRequest(jobID, leaseID, fenceToken, now, job.RequestStop)
}

func (s *Store) RequestKill(jobID, leaseID string, fenceToken uint64, now time.Time) (Record, error) {
	return s.remoteRequest(jobID, leaseID, fenceToken, now, job.RequestKill)
}

func (s *Store) remoteRequest(jobID, leaseID string, fenceToken uint64, now time.Time, transition func(job.Status) (job.Status, error)) (Record, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, err := currentRecord(s.state, jobID, leaseID, fenceToken, now, true)
	if err != nil {
		return Record{}, err
	}
	target, err := transition(record.Status)
	if err != nil {
		return Record{}, err
	}
	if target == record.Status {
		return record, nil
	}
	record.Status = target
	record.UpdatedAt = now.UTC()
	next := cloneState(s.state)
	next.Jobs[jobID] = record
	if err := persist(s.filename, next); err != nil {
		return Record{}, err
	}
	s.state = next
	return record, nil
}

func currentRecord(state diskState, jobID, leaseID string, fenceToken uint64, now time.Time, enforceExpiry bool) (Record, error) {
	record, ok := state.Jobs[jobID]
	if !ok {
		return Record{}, ErrJobNotFound
	}
	currentFence := record.Envelope.Lease.FenceToken
	if fenceToken < currentFence {
		return Record{}, fmt.Errorf("%w: current=%d received=%d", ErrStaleFence, currentFence, fenceToken)
	}
	if fenceToken > currentFence {
		return Record{}, fmt.Errorf("%w: current=%d received=%d", ErrFenceConflict, currentFence, fenceToken)
	}
	if leaseID != record.Envelope.Lease.ID {
		return Record{}, ErrLeaseMismatch
	}
	if enforceExpiry && !now.Before(record.Envelope.Lease.ExpiresAt) {
		return Record{}, ErrLeaseExpired
	}
	return record, nil
}

func cloneState(state diskState) diskState {
	cloned := diskState{
		Version:     state.Version,
		Jobs:        make(map[string]Record, len(state.Jobs)),
		Idempotency: make(map[string]idempotencyRecord, len(state.Idempotency)),
	}
	for key, record := range state.Jobs {
		cloned.Jobs[key] = record
	}
	for key, record := range state.Idempotency {
		cloned.Idempotency[key] = record
	}
	return cloned
}

func persist(filename string, state diskState) error {
	directory := filepath.Dir(filename)
	temporary, err := os.CreateTemp(directory, ".jobs-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary job store: %w", err)
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("set job store permissions: %w", err)
	}
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(state); err != nil {
		temporary.Close()
		return fmt.Errorf("encode job store: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync job store: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close job store: %w", err)
	}
	if err := os.Rename(temporaryName, filename); err != nil {
		return fmt.Errorf("replace job store: %w", err)
	}
	directoryHandle, err := os.Open(directory)
	if err == nil {
		defer directoryHandle.Close()
		if err := directoryHandle.Sync(); err != nil {
			return fmt.Errorf("sync job store directory: %w", err)
		}
	}
	return nil
}
