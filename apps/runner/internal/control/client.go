package control

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var (
	ErrDisabled     = errors.New("control connection disabled")
	ErrNotConnected = errors.New("control connection not connected")
)

type State string

const (
	StateDisabled     State = "disabled"
	StateDisconnected State = "disconnected"
	StateConnecting   State = "connecting"
	StateConnected    State = "connected"
)

type Handler func(context.Context, []byte) error

type Client interface {
	Enabled() bool
	State() State
	Run(context.Context, Handler) error
	Send(context.Context, []byte) error
}

func New(rawURL string, headers ...http.Header) Client {
	if rawURL == "" {
		return DisabledClient{}
	}
	header := make(http.Header)
	if len(headers) > 0 {
		header = headers[0].Clone()
	}
	return &WebSocketClient{
		url:    rawURL,
		header: header,
		dialer: websocket.Dialer{
			HandshakeTimeout: 10 * time.Second,
		},
		state: StateDisconnected,
	}
}

type DisabledClient struct{}

func (DisabledClient) Enabled() bool { return false }
func (DisabledClient) State() State  { return StateDisabled }

func (DisabledClient) Run(ctx context.Context, _ Handler) error {
	<-ctx.Done()
	return nil
}

func (DisabledClient) Send(context.Context, []byte) error { return ErrDisabled }

type WebSocketClient struct {
	url     string
	header  http.Header
	dialer  websocket.Dialer
	mu      sync.RWMutex
	writeMu sync.Mutex
	conn    *websocket.Conn
	state   State
}

func (c *WebSocketClient) Enabled() bool { return true }

func (c *WebSocketClient) State() State {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.state
}

func (c *WebSocketClient) Run(ctx context.Context, handler Handler) error {
	backoff := time.Second
	for {
		if err := ctx.Err(); err != nil {
			return nil
		}
		c.setConnection(nil, StateConnecting)
		connection, _, err := c.dialer.DialContext(ctx, c.url, c.header)
		if err != nil {
			c.setConnection(nil, StateDisconnected)
			if !wait(ctx, backoff) {
				return nil
			}
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second
		connection.SetReadLimit(4 * 1024 * 1024)
		c.setConnection(connection, StateConnected)
		watchDone := make(chan struct{})
		go func() {
			select {
			case <-ctx.Done():
				_ = connection.Close()
			case <-watchDone:
			}
		}()
		for {
			messageType, data, readErr := connection.ReadMessage()
			if readErr != nil {
				break
			}
			if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
				continue
			}
			if handler != nil {
				_ = handler(ctx, data)
			}
		}
		close(watchDone)
		_ = connection.Close()
		c.clearConnection(connection)
	}
}

func (c *WebSocketClient) Send(ctx context.Context, payload []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	c.mu.RLock()
	connection := c.conn
	c.mu.RUnlock()
	if connection == nil {
		return ErrNotConnected
	}
	deadline := time.Now().Add(10 * time.Second)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := connection.SetWriteDeadline(deadline); err != nil {
		return fmt.Errorf("set websocket write deadline: %w", err)
	}
	if err := connection.WriteMessage(websocket.TextMessage, payload); err != nil {
		return fmt.Errorf("write websocket message: %w", err)
	}
	return nil
}

func (c *WebSocketClient) setConnection(connection *websocket.Conn, state State) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.conn = connection
	c.state = state
}

func (c *WebSocketClient) clearConnection(connection *websocket.Conn) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == connection {
		c.conn = nil
		c.state = StateDisconnected
	}
}

func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
