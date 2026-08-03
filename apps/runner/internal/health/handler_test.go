package health

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/control"
	"github.com/gosu-research/gosu/apps/runner/internal/events"
)

func TestHealthResponse(t *testing.T) {
	spool, err := events.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := spool.Append("test", "", nil, time.Now()); err != nil {
		t.Fatal(err)
	}
	fixed := time.Date(2026, time.August, 3, 12, 0, 0, 0, time.UTC)
	handler := Handler{
		RunnerID: "runner-test", Control: control.New(""), Spool: spool,
		Now: func() time.Time { return fixed },
	}
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status code = %d", response.Code)
	}
	var body Response
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "ok" || body.Control != control.StateDisabled || body.LastSequence != 1 || body.Time != fixed {
		t.Fatalf("body = %+v", body)
	}
}

func TestHealthRejectsNonGET(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/healthz", nil)
	response := httptest.NewRecorder()
	(Handler{}).ServeHTTP(response, request)
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status code = %d", response.Code)
	}
}
