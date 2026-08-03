package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/control"
	"github.com/gosu-research/gosu/apps/runner/internal/events"
	"github.com/gosu-research/gosu/apps/runner/internal/job"
	"github.com/gosu-research/gosu/apps/runner/internal/podman"
	"github.com/gosu-research/gosu/apps/runner/internal/policy"
	"github.com/gosu-research/gosu/apps/runner/internal/store"
)

type CommandExecutor interface {
	Run(context.Context, podman.Command, io.Writer, io.Writer) error
}

type OSCommandExecutor struct{}

func (OSCommandExecutor) Run(ctx context.Context, command podman.Command, stdout, stderr io.Writer) error {
	process := exec.CommandContext(ctx, command.Name, command.Args...)
	process.Stdout = stdout
	process.Stderr = stderr
	return process.Run()
}

type Service struct {
	RunnerID       string
	ProjectID      string
	StateDirectory string
	Store          *store.Store
	Spool          *events.Spool
	Policy         policy.Policy
	Podman         podman.Builder
	Executor       CommandExecutor
	StopGrace      time.Duration
	Now            func() time.Time
	waitGroup      sync.WaitGroup
}

type PolicyError struct {
	Decision policy.Decision
}

func (e PolicyError) Error() string {
	return fmt.Sprintf("job rejected by policy: %s: %s", e.Decision.Code, e.Decision.Reason)
}

type inboundMessage struct {
	Type       string          `json:"type"`
	Envelope   json.RawMessage `json:"envelope,omitempty"`
	JobID      string          `json:"job_id,omitempty"`
	LeaseID    string          `json:"lease_id,omitempty"`
	FenceToken uint64          `json:"fence_token,omitempty"`
	Sequence   uint64          `json:"sequence,omitempty"`
}

type outboundEvent struct {
	Type      string           `json:"type"`
	ProjectID string           `json:"projectId"`
	RunnerID  string           `json:"runnerId"`
	Event     runnerStateEvent `json:"event"`
}

type runnerStateEvent struct {
	SchemaVersion int       `json:"schemaVersion"`
	EventID       string    `json:"eventId"`
	RunnerID      string    `json:"runnerId"`
	CampaignID    string    `json:"campaignId"`
	TrialID       string    `json:"trialId"`
	AttemptID     string    `json:"attemptId"`
	Sequence      uint64    `json:"sequence"`
	OccurredAt    time.Time `json:"occurredAt"`
	Kind          string    `json:"kind"`
	State         string    `json:"state"`
	PreviousState string    `json:"previousState,omitempty"`
	Reason        string    `json:"reason,omitempty"`
}

type outboundHello struct {
	Type            string `json:"type"`
	ProjectID       string `json:"projectId"`
	RunnerID        string `json:"runnerId"`
	ProtocolVersion string `json:"protocolVersion"`
}

func (s *Service) HandleControl(ctx context.Context, data []byte) error {
	var message inboundMessage
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&message); err != nil {
		return fmt.Errorf("decode control message: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("control message must contain exactly one JSON object")
		}
		return fmt.Errorf("decode trailing control JSON: %w", err)
	}
	switch message.Type {
	case "job.submit":
		if len(message.Envelope) == 0 {
			return fmt.Errorf("job.submit requires envelope")
		}
		return s.Submit(ctx, message.Envelope)
	case "job.stop":
		return s.Stop(ctx, message.JobID, message.LeaseID, message.FenceToken)
	case "job.kill":
		return s.Kill(ctx, message.JobID, message.LeaseID, message.FenceToken)
	case "events.ack":
		return s.Spool.Ack(message.Sequence)
	default:
		return fmt.Errorf("unsupported control message type %q", message.Type)
	}
}

func (s *Service) Submit(ctx context.Context, rawEnvelope []byte) error {
	now := s.now()
	envelope, err := job.DecodeEnvelope(rawEnvelope, now)
	if err != nil {
		return err
	}
	jobID := envelope.Manifest.JobID
	decision := s.Policy.Evaluate(envelope)
	if !decision.Allowed {
		result := store.AcceptResult{}
		if _, getErr := s.Store.Get(jobID); errors.Is(getErr, store.ErrJobNotFound) {
			var storeErr error
			result, storeErr = s.Store.Reject(envelope, decision.Code, decision.Reason, now)
			if storeErr != nil {
				return storeErr
			}
		} else if getErr != nil {
			return getErr
		}
		if !result.Duplicate {
			s.appendJob("job.policy_rejected", envelope.Manifest, map[string]any{
				"decision": decision, "fence_token": envelope.Lease.FenceToken,
			}, now)
		}
		return PolicyError{Decision: decision}
	}
	result, err := s.Store.Accept(envelope, now)
	if err != nil {
		return err
	}
	if result.Duplicate {
		return nil
	}
	if result.Superseded != nil && (result.Superseded.Status == job.StatusRunning || result.Superseded.Status == job.StatusStopRequested || result.Superseded.Status == job.StatusKillRequested) {
		killContext, cancel := context.WithTimeout(ctx, 15*time.Second)
		killErr := s.Executor.Run(killContext, s.Podman.Kill(jobID), io.Discard, io.Discard)
		cancel()
		if killErr != nil {
			_, _ = s.Store.Transition(jobID, envelope.Lease.ID, envelope.Lease.FenceToken, job.StatusFailed, now)
			s.appendJob("job.supersede_failed", envelope.Manifest, map[string]string{"reason": killErr.Error()}, now)
			return fmt.Errorf("kill superseded podman job: %w", killErr)
		}
		s.appendJob("job.lease_superseded", result.Superseded.Envelope.Manifest, map[string]uint64{
			"previous_fence_token": result.Superseded.Envelope.Lease.FenceToken,
			"current_fence_token":  envelope.Lease.FenceToken,
		}, now)
	}
	if _, err := s.Store.Transition(jobID, envelope.Lease.ID, envelope.Lease.FenceToken, job.StatusQueued, now); err != nil {
		return err
	}
	s.appendJob("job.queued", envelope.Manifest, nil, now)
	s.waitGroup.Add(1)
	go func() {
		defer s.waitGroup.Done()
		s.execute(ctx, envelope)
	}()
	return nil
}

func (s *Service) Stop(ctx context.Context, jobID, leaseID string, fenceToken uint64) error {
	before, err := s.Store.Get(jobID)
	if err != nil {
		return err
	}
	record, err := s.Store.RequestStop(jobID, leaseID, fenceToken, s.now())
	if err != nil {
		return err
	}
	if record.Status == before.Status {
		return nil
	}
	s.appendJob("job.stop_requested", record.Envelope.Manifest, map[string]string{"state": string(record.Status)}, s.now())
	if record.Status != job.StatusStopRequested {
		return nil
	}
	stopContext, cancel := context.WithTimeout(ctx, s.StopGrace+10*time.Second)
	defer cancel()
	if err := s.Executor.Run(stopContext, s.Podman.Stop(jobID, s.StopGrace), io.Discard, io.Discard); err != nil {
		s.appendJob("job.stop_failed", record.Envelope.Manifest, map[string]string{"reason": err.Error()}, s.now())
		return fmt.Errorf("stop podman job: %w", err)
	}
	return nil
}

func (s *Service) Kill(ctx context.Context, jobID, leaseID string, fenceToken uint64) error {
	before, err := s.Store.Get(jobID)
	if err != nil {
		return err
	}
	record, err := s.Store.RequestKill(jobID, leaseID, fenceToken, s.now())
	if err != nil {
		return err
	}
	if record.Status == before.Status {
		return nil
	}
	s.appendJob("job.kill_requested", record.Envelope.Manifest, map[string]string{"state": string(record.Status)}, s.now())
	if record.Status != job.StatusKillRequested {
		return nil
	}
	killContext, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := s.Executor.Run(killContext, s.Podman.Kill(jobID), io.Discard, io.Discard); err != nil {
		s.appendJob("job.kill_failed", record.Envelope.Manifest, map[string]string{"reason": err.Error()}, s.now())
		return fmt.Errorf("kill podman job: %w", err)
	}
	return nil
}

func (s *Service) DeliverEvents(ctx context.Context, client control.Client) error {
	if !client.Enabled() {
		<-ctx.Done()
		return nil
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	announced := false
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if client.State() != control.StateConnected {
				announced = false
				continue
			}
			if !announced {
				hello, err := json.Marshal(outboundHello{Type: "runner.hello", ProjectID: s.ProjectID, RunnerID: s.RunnerID, ProtocolVersion: "v1"})
				if err != nil {
					return err
				}
				if err := client.Send(ctx, hello); err != nil {
					continue
				}
				announced = true
			}
			pending, err := s.Spool.Pending(100)
			if err != nil {
				return err
			}
			for _, event := range pending {
				wireEvent, err := s.toOutboundEvent(event)
				if err != nil {
					return err
				}
				payload, err := json.Marshal(wireEvent)
				if err != nil {
					return err
				}
				if err := client.Send(ctx, payload); err != nil {
					break
				}
			}
		}
	}
}

func (s *Service) toOutboundEvent(event events.Event) (outboundEvent, error) {
	if s.ProjectID == "" || s.RunnerID == "" {
		return outboundEvent{}, fmt.Errorf("runner event transport requires project and runner IDs")
	}
	if event.CampaignID == "" || event.TrialID == "" || event.AttemptID == "" {
		return outboundEvent{}, fmt.Errorf("durable event %d is missing trial lineage", event.Sequence)
	}
	state, previousState, defaultReason, ok := sharedState(event.Type)
	if !ok {
		return outboundEvent{}, fmt.Errorf("durable event %d has unsupported type %q", event.Sequence, event.Type)
	}
	reason := eventReason(event.Payload)
	if reason == "" {
		reason = defaultReason
	}
	return outboundEvent{
		Type:      "runner.event",
		ProjectID: s.ProjectID,
		RunnerID:  s.RunnerID,
		Event: runnerStateEvent{
			SchemaVersion: 1,
			EventID:       event.EventID,
			RunnerID:      s.RunnerID,
			CampaignID:    event.CampaignID,
			TrialID:       event.TrialID,
			AttemptID:     event.AttemptID,
			Sequence:      event.Sequence,
			OccurredAt:    event.At.UTC(),
			Kind:          "state",
			State:         state,
			PreviousState: previousState,
			Reason:        truncateReason(reason),
		},
	}, nil
}

func sharedState(eventType string) (state, previousState, reason string, ok bool) {
	switch eventType {
	case "job.queued":
		return "leased", "pending", "", true
	case "job.running":
		return "running", "leased", "", true
	case "job.succeeded":
		return "succeeded", "running", "", true
	case "job.failed":
		return "failed", "running", "", true
	case "job.stopped":
		return "cancelled", "running", "graceful stop completed", true
	case "job.killed":
		return "cancelled", "running", "kill completed", true
	case "job.policy_rejected":
		return "failed", "pending", "runner policy rejected the job", true
	case "job.lease_superseded":
		return "lost", "running", "runner lease was superseded", true
	case "job.supersede_failed":
		return "failed", "pending", "superseded workload could not be reconciled", true
	case "job.start_failed":
		return "failed", "leased", "runner could not start the workload", true
	case "job.state_error":
		return "failed", "", "runner state persistence failed", true
	case "job.stop_requested":
		return "running", "running", "graceful stop requested", true
	case "job.stop_failed":
		return "running", "running", "graceful stop command failed", true
	case "job.kill_requested":
		return "running", "running", "immediate kill requested", true
	case "job.kill_failed":
		return "running", "running", "immediate kill command failed", true
	default:
		return "", "", "", false
	}
}

func eventReason(payload json.RawMessage) string {
	if len(payload) == 0 {
		return ""
	}
	var decoded struct {
		Reason   string `json:"reason"`
		Decision struct {
			Code   string `json:"code"`
			Reason string `json:"reason"`
		} `json:"decision"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return ""
	}
	if decoded.Reason != "" {
		return decoded.Reason
	}
	if decoded.Decision.Code != "" && decoded.Decision.Reason != "" {
		return decoded.Decision.Code + ": " + decoded.Decision.Reason
	}
	return decoded.Decision.Reason
}

func truncateReason(reason string) string {
	runes := []rune(reason)
	if len(runes) > 2000 {
		return string(runes[:2000])
	}
	return reason
}

func (s *Service) appendJob(eventType string, manifest job.Manifest, payload any, now time.Time) {
	_, _ = s.Spool.AppendJob(eventType, events.JobMetadata{
		JobID:      manifest.JobID,
		CampaignID: manifest.CampaignID,
		TrialID:    manifest.TrialID,
		AttemptID:  manifest.AttemptID,
	}, payload, now)
}

func (s *Service) Wait() {
	s.waitGroup.Wait()
}

func (s *Service) execute(parent context.Context, envelope job.Envelope) {
	now := s.now()
	manifest := envelope.Manifest
	jobID := manifest.JobID
	if _, err := s.Store.Transition(jobID, envelope.Lease.ID, envelope.Lease.FenceToken, job.StatusRunning, now); err != nil {
		s.appendJob("job.start_failed", envelope.Manifest, map[string]string{"reason": err.Error()}, now)
		return
	}
	s.appendJob("job.running", envelope.Manifest, nil, now)
	localName := podman.ContainerName(jobID)
	workspace := filepath.Join(s.StateDirectory, "workspaces", localName)
	logs := filepath.Join(s.StateDirectory, "logs")
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		s.finish(envelope, job.StatusFailed, err)
		return
	}
	if err := os.MkdirAll(logs, 0o700); err != nil {
		s.finish(envelope, job.StatusFailed, err)
		return
	}
	stdout, err := os.OpenFile(filepath.Join(logs, localName+".stdout.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		s.finish(envelope, job.StatusFailed, err)
		return
	}
	defer stdout.Close()
	stderr, err := os.OpenFile(filepath.Join(logs, localName+".stderr.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		s.finish(envelope, job.StatusFailed, err)
		return
	}
	defer stderr.Close()
	command, err := s.Podman.Run(manifest, workspace)
	if err != nil {
		s.finish(envelope, job.StatusFailed, err)
		return
	}
	runContext, cancel := context.WithTimeout(parent, time.Duration(manifest.TimeoutSeconds)*time.Second)
	err = s.Executor.Run(runContext, command, stdout, stderr)
	timedOut := errors.Is(runContext.Err(), context.DeadlineExceeded)
	cancel()
	current, getErr := s.Store.Get(jobID)
	if getErr != nil || current.Envelope.Lease.FenceToken != envelope.Lease.FenceToken {
		return
	}
	switch current.Status {
	case job.StatusStopRequested:
		s.finish(envelope, job.StatusStopped, err)
	case job.StatusKillRequested:
		s.finish(envelope, job.StatusKilled, err)
	case job.StatusRunning:
		if timedOut {
			killContext, killCancel := context.WithTimeout(context.Background(), 15*time.Second)
			_ = s.Executor.Run(killContext, s.Podman.Kill(jobID), io.Discard, io.Discard)
			killCancel()
			_, _ = s.Store.Transition(jobID, envelope.Lease.ID, envelope.Lease.FenceToken, job.StatusKillRequested, s.now())
			s.finish(envelope, job.StatusKilled, context.DeadlineExceeded)
		} else if err == nil {
			s.finish(envelope, job.StatusSucceeded, nil)
		} else {
			s.finish(envelope, job.StatusFailed, err)
		}
	}
}

func (s *Service) finish(envelope job.Envelope, status job.Status, runError error) {
	jobID := envelope.Manifest.JobID
	payload := map[string]string{"state": string(status)}
	if runError != nil {
		payload["reason"] = runError.Error()
	}
	if _, err := s.Store.Transition(jobID, envelope.Lease.ID, envelope.Lease.FenceToken, status, s.now()); err != nil {
		s.appendJob("job.state_error", envelope.Manifest, map[string]string{"reason": err.Error()}, s.now())
		return
	}
	s.appendJob("job."+string(status), envelope.Manifest, payload, s.now())
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}
