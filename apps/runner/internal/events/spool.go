package events

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Event struct {
	Sequence   uint64          `json:"sequence"`
	EventID    string          `json:"event_id"`
	JobID      string          `json:"job_id,omitempty"`
	CampaignID string          `json:"campaign_id,omitempty"`
	TrialID    string          `json:"trial_id,omitempty"`
	AttemptID  string          `json:"attempt_id,omitempty"`
	Type       string          `json:"type"`
	At         time.Time       `json:"at"`
	Payload    json.RawMessage `json:"payload,omitempty"`
}

type JobMetadata struct {
	JobID      string
	CampaignID string
	TrialID    string
	AttemptID  string
}

type Spool struct {
	mu       sync.Mutex
	filename string
	ackFile  string
	last     uint64
	acked    uint64
}

func Open(directory string) (*Spool, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create event spool directory: %w", err)
	}
	spool := &Spool{
		filename: filepath.Join(directory, "events.jsonl"),
		ackFile:  filepath.Join(directory, "events.ack"),
	}
	if err := spool.scan(nil); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(spool.ackFile)
	if err == nil {
		acked, parseErr := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64)
		if parseErr != nil {
			return nil, fmt.Errorf("decode event acknowledgement: %w", parseErr)
		}
		if acked > spool.last {
			return nil, fmt.Errorf("event acknowledgement %d exceeds last sequence %d", acked, spool.last)
		}
		spool.acked = acked
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read event acknowledgement: %w", err)
	}
	return spool, nil
}

func (s *Spool) Append(eventType, jobID string, payload any, now time.Time) (Event, error) {
	return s.AppendJob(eventType, JobMetadata{JobID: jobID}, payload, now)
}

func (s *Spool) AppendJob(eventType string, metadata JobMetadata, payload any, now time.Time) (Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(eventType) == "" {
		return Event{}, fmt.Errorf("event type must not be empty")
	}
	var encodedPayload json.RawMessage
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return Event{}, fmt.Errorf("encode event payload: %w", err)
		}
		encodedPayload = encoded
	}
	sequence := s.last + 1
	event := Event{
		Sequence:   sequence,
		EventID:    fmt.Sprintf("event-%020d", sequence),
		JobID:      metadata.JobID,
		CampaignID: metadata.CampaignID,
		TrialID:    metadata.TrialID,
		AttemptID:  metadata.AttemptID,
		Type:       eventType,
		At:         now.UTC(),
		Payload:    encodedPayload,
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		return Event{}, fmt.Errorf("encode event: %w", err)
	}
	file, err := os.OpenFile(s.filename, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return Event{}, fmt.Errorf("open event spool: %w", err)
	}
	if _, err := file.Write(append(encoded, '\n')); err != nil {
		file.Close()
		return Event{}, fmt.Errorf("append event spool: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return Event{}, fmt.Errorf("sync event spool: %w", err)
	}
	if err := file.Close(); err != nil {
		return Event{}, fmt.Errorf("close event spool: %w", err)
	}
	if err := syncDirectory(filepath.Dir(s.filename)); err != nil {
		return Event{}, err
	}
	s.last = sequence
	return event, nil
}

func (s *Spool) Pending(limit int) ([]Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	events := make([]Event, 0)
	if err := s.scan(func(event Event) error {
		if event.Sequence <= s.acked {
			return nil
		}
		if limit > 0 && len(events) >= limit {
			return nil
		}
		events = append(events, event)
		return nil
	}); err != nil {
		return nil, err
	}
	return events, nil
}

func (s *Spool) Ack(sequence uint64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sequence < s.acked {
		return nil
	}
	if sequence > s.last {
		return fmt.Errorf("acknowledgement %d exceeds last sequence %d", sequence, s.last)
	}
	if sequence == s.acked {
		return nil
	}
	if err := atomicWrite(s.ackFile, []byte(strconv.FormatUint(sequence, 10)+"\n")); err != nil {
		return err
	}
	s.acked = sequence
	return nil
}

func (s *Spool) Position() (last, acked uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.last, s.acked
}

func (s *Spool) scan(visit func(Event) error) error {
	file, err := os.Open(s.filename)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("open event spool: %w", err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	var previous uint64
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var event Event
		if err := json.Unmarshal(line, &event); err != nil {
			return fmt.Errorf("decode event spool: %w", err)
		}
		if event.Sequence == 0 || (previous != 0 && event.Sequence != previous+1) {
			return fmt.Errorf("event sequence is not contiguous at %d", event.Sequence)
		}
		previous = event.Sequence
		if visit != nil {
			if err := visit(event); err != nil {
				return err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("scan event spool: %w", err)
	}
	if previous > s.last {
		s.last = previous
	}
	return nil
}

func atomicWrite(filename string, data []byte) error {
	directory := filepath.Dir(filename)
	temporary, err := os.CreateTemp(directory, ".events-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary event file: %w", err)
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryName, filename); err != nil {
		return err
	}
	return syncDirectory(directory)
}

func syncDirectory(directory string) error {
	handle, err := os.Open(directory)
	if err != nil {
		return fmt.Errorf("open event directory: %w", err)
	}
	defer handle.Close()
	if err := handle.Sync(); err != nil {
		return fmt.Errorf("sync event directory: %w", err)
	}
	return nil
}
