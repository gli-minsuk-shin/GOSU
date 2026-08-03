package health

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/control"
	"github.com/gosu-research/gosu/apps/runner/internal/events"
)

type Handler struct {
	RunnerID         string
	ExecutionEnabled bool
	Control          control.Client
	Spool            *events.Spool
	Now              func() time.Time
}

type Response struct {
	Status           string        `json:"status"`
	RunnerID         string        `json:"runner_id"`
	ExecutionEnabled bool          `json:"execution_enabled"`
	Control          control.State `json:"control"`
	LastSequence     uint64        `json:"last_sequence"`
	AckedSequence    uint64        `json:"acked_sequence"`
	Time             time.Time     `json:"time"`
}

func (h Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writer.Header().Set("Allow", http.MethodGet)
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	state := control.StateDisabled
	if h.Control != nil {
		state = h.Control.State()
	}
	status := "ok"
	if state == control.StateDisconnected || state == control.StateConnecting {
		status = "degraded"
	}
	var last, acked uint64
	if h.Spool != nil {
		last, acked = h.Spool.Position()
	}
	now := time.Now
	if h.Now != nil {
		now = h.Now
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(writer).Encode(Response{
		Status: status, RunnerID: h.RunnerID, ExecutionEnabled: h.ExecutionEnabled,
		Control: state, LastSequence: last, AckedSequence: acked, Time: now().UTC(),
	})
}
