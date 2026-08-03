package control

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestEmptyURLSelectsDisabledClient(t *testing.T) {
	client := New("")
	if client.Enabled() || client.State() != StateDisabled {
		t.Fatalf("client = enabled:%t state:%s", client.Enabled(), client.State())
	}
	if err := client.Send(context.Background(), []byte("{}")); !errors.Is(err, ErrDisabled) {
		t.Fatalf("Send() error = %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := client.Run(ctx, nil); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
}

func TestWebSocketClientCopiesExplicitDevelopmentHeaders(t *testing.T) {
	headers := make(http.Header)
	headers.Set("x-gosu-client-kind", "runner")
	headers.Set("x-gosu-lab", "lab-demo")
	headers.Set("x-gosu-sub", "runner-test")
	headers.Set("x-gosu-role", "project_lead")
	client, ok := New("ws://127.0.0.1:3001/v1/relay", headers).(*WebSocketClient)
	if !ok {
		t.Fatal("New() did not return WebSocketClient")
	}
	headers.Set("x-gosu-lab", "changed")
	if client.header.Get("x-gosu-client-kind") != "runner" || client.header.Get("x-gosu-lab") != "lab-demo" || client.header.Get("x-gosu-role") != "project_lead" {
		t.Fatalf("client headers = %#v", client.header)
	}
}
