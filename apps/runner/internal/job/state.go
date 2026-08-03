package job

import "fmt"

type Status string

const (
	StatusAccepted      Status = "accepted"
	StatusQueued        Status = "queued"
	StatusRunning       Status = "running"
	StatusStopRequested Status = "stop_requested"
	StatusStopped       Status = "stopped"
	StatusKillRequested Status = "kill_requested"
	StatusKilled        Status = "killed"
	StatusSucceeded     Status = "succeeded"
	StatusFailed        Status = "failed"
	StatusRejected      Status = "rejected"
)

func (s Status) Terminal() bool {
	switch s {
	case StatusStopped, StatusKilled, StatusSucceeded, StatusFailed, StatusRejected:
		return true
	default:
		return false
	}
}

func CanTransition(from, to Status) bool {
	if from == to {
		return true
	}
	switch from {
	case StatusAccepted:
		return to == StatusQueued || to == StatusStopped || to == StatusKilled || to == StatusFailed || to == StatusRejected
	case StatusQueued:
		return to == StatusRunning || to == StatusStopped || to == StatusKilled || to == StatusFailed || to == StatusRejected
	case StatusRunning:
		return to == StatusStopRequested || to == StatusKillRequested || to == StatusSucceeded || to == StatusFailed
	case StatusStopRequested:
		return to == StatusStopped || to == StatusKillRequested || to == StatusFailed
	case StatusKillRequested:
		return to == StatusKilled || to == StatusFailed
	default:
		return false
	}
}

func RequestStop(status Status) (Status, error) {
	switch status {
	case StatusAccepted, StatusQueued:
		return StatusStopped, nil
	case StatusRunning:
		return StatusStopRequested, nil
	case StatusStopRequested, StatusStopped:
		return status, nil
	case StatusKillRequested, StatusKilled:
		return status, nil
	default:
		return status, fmt.Errorf("cannot stop terminal job in state %s", status)
	}
}

func RequestKill(status Status) (Status, error) {
	switch status {
	case StatusAccepted, StatusQueued:
		return StatusKilled, nil
	case StatusRunning, StatusStopRequested:
		return StatusKillRequested, nil
	case StatusKillRequested, StatusKilled:
		return status, nil
	default:
		return status, fmt.Errorf("cannot kill terminal job in state %s", status)
	}
}
