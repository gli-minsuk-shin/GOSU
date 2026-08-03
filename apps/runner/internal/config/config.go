package config

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/gpu"
)

const (
	defaultListenAddress  = "127.0.0.1:8088"
	defaultStateDirectory = "./var/gosu-runner"
)

var (
	runnerIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
	digestPattern   = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
)

// Config contains only non-secret runner settings. Authentication material is
// intentionally not accepted by this skeleton; add a file-backed secret
// provider before enabling authenticated control-plane connections.
type Config struct {
	RunnerID            string
	ProjectID           string
	ListenAddress       string
	StateDirectory      string
	ControlWebSocket    string
	ControlLabID        string
	PodmanBinary        string
	ExecutionEnabled    bool
	AllowedImageDigests []string
	AllowedExecutables  []string
	AllowedSecretRefs   []string
	AllowedNetworkHosts []string
	ApprovedGPUDevices  []string
	SigningPublicKeys   map[string]ed25519.PublicKey
	AllowJobNetwork     bool
	PolicyVersion       int64
	PolicyHash          string
	MaxCPUs             float64
	MaxMemoryMB         int64
	MaxPIDs             int64
	MaxGPUMemoryMiB     int64
	MaxRuntime          time.Duration
	StopGrace           time.Duration
}

type LookupEnv func(string) (string, bool)

func Load(lookup LookupEnv) (Config, error) {
	cfg := Config{
		RunnerID:            value(lookup, "GOSU_RUNNER_ID", "local-dev-runner"),
		ProjectID:           strings.TrimSpace(value(lookup, "GOSU_RUNNER_PROJECT_ID", "")),
		ListenAddress:       value(lookup, "GOSU_RUNNER_LISTEN_ADDR", defaultListenAddress),
		StateDirectory:      value(lookup, "GOSU_RUNNER_STATE_DIR", defaultStateDirectory),
		ControlWebSocket:    strings.TrimSpace(value(lookup, "GOSU_RUNNER_CONTROL_WS_URL", "")),
		ControlLabID:        strings.TrimSpace(value(lookup, "GOSU_RUNNER_CONTROL_LAB_ID", "")),
		PodmanBinary:        value(lookup, "GOSU_RUNNER_PODMAN_BINARY", "podman"),
		AllowedImageDigests: csv(value(lookup, "GOSU_RUNNER_ALLOWED_IMAGE_DIGESTS", "")),
		AllowedExecutables:  csv(value(lookup, "GOSU_RUNNER_ALLOWED_EXECUTABLES", "python3,python")),
		AllowedSecretRefs:   csv(value(lookup, "GOSU_RUNNER_ALLOWED_SECRET_REFS", "")),
		AllowedNetworkHosts: csv(value(lookup, "GOSU_RUNNER_ALLOWED_NETWORK_HOSTS", "")),
		ApprovedGPUDevices:  csv(value(lookup, "GOSU_RUNNER_GPU_DEVICES", "")),
		PolicyHash:          value(lookup, "GOSU_RUNNER_POLICY_HASH", "local-policy-v1"),
	}

	var err error
	if cfg.SigningPublicKeys, err = signingKeys(value(lookup, "GOSU_RUNNER_SIGNING_PUBLIC_KEYS", "")); err != nil {
		return Config{}, err
	}
	if cfg.ExecutionEnabled, err = boolean(lookup, "GOSU_RUNNER_EXECUTION_ENABLED", false); err != nil {
		return Config{}, err
	}
	if cfg.AllowJobNetwork, err = boolean(lookup, "GOSU_RUNNER_ALLOW_JOB_NETWORK", false); err != nil {
		return Config{}, err
	}
	if cfg.MaxCPUs, err = positiveFloat(lookup, "GOSU_RUNNER_MAX_CPUS", 4); err != nil {
		return Config{}, err
	}
	if cfg.MaxMemoryMB, err = positiveInt(lookup, "GOSU_RUNNER_MAX_MEMORY_MB", 8192); err != nil {
		return Config{}, err
	}
	if cfg.MaxPIDs, err = positiveInt(lookup, "GOSU_RUNNER_MAX_PIDS", 512); err != nil {
		return Config{}, err
	}
	if cfg.MaxGPUMemoryMiB, err = nonnegativeInt(lookup, "GOSU_RUNNER_MAX_GPU_MEMORY_MIB", 0); err != nil {
		return Config{}, err
	}
	if cfg.PolicyVersion, err = positiveInt(lookup, "GOSU_RUNNER_POLICY_VERSION", 1); err != nil {
		return Config{}, err
	}
	maxRuntimeSeconds, err := positiveInt(lookup, "GOSU_RUNNER_MAX_RUNTIME_SECONDS", 7200)
	if err != nil {
		return Config{}, err
	}
	stopGraceSeconds, err := positiveInt(lookup, "GOSU_RUNNER_STOP_GRACE_SECONDS", 15)
	if err != nil {
		return Config{}, err
	}
	cfg.MaxRuntime = time.Duration(maxRuntimeSeconds) * time.Second
	cfg.StopGrace = time.Duration(stopGraceSeconds) * time.Second

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Validate() error {
	if !runnerIDPattern.MatchString(c.RunnerID) {
		return fmt.Errorf("GOSU_RUNNER_ID is invalid")
	}
	if strings.TrimSpace(c.ListenAddress) == "" {
		return fmt.Errorf("GOSU_RUNNER_LISTEN_ADDR must not be empty")
	}
	if strings.TrimSpace(c.StateDirectory) == "" {
		return fmt.Errorf("GOSU_RUNNER_STATE_DIR must not be empty")
	}
	if strings.TrimSpace(c.PodmanBinary) == "" || strings.ContainsAny(c.PodmanBinary, "\x00\r\n") {
		return fmt.Errorf("GOSU_RUNNER_PODMAN_BINARY is invalid")
	}
	if c.ExecutionEnabled && len(c.AllowedImageDigests) == 0 {
		return fmt.Errorf("execution requires at least one GOSU_RUNNER_ALLOWED_IMAGE_DIGESTS entry")
	}
	if c.ExecutionEnabled && len(c.SigningPublicKeys) == 0 {
		return fmt.Errorf("execution requires at least one GOSU_RUNNER_SIGNING_PUBLIC_KEYS entry")
	}
	if len(c.AllowedExecutables) == 0 {
		return fmt.Errorf("GOSU_RUNNER_ALLOWED_EXECUTABLES must not be empty")
	}
	if c.AllowJobNetwork || len(c.AllowedNetworkHosts) != 0 {
		return fmt.Errorf("job network allowlists are unavailable until an enforceable egress adapter is configured")
	}
	for _, digest := range c.AllowedImageDigests {
		if !digestPattern.MatchString(digest) {
			return fmt.Errorf("GOSU_RUNNER_ALLOWED_IMAGE_DIGESTS contains an invalid digest")
		}
	}
	for _, selector := range c.ApprovedGPUDevices {
		if err := gpu.ValidateSelector(selector); err != nil {
			return fmt.Errorf("GOSU_RUNNER_GPU_DEVICES contains an invalid selector: %w", err)
		}
	}
	if len(c.ApprovedGPUDevices) > 0 && c.MaxGPUMemoryMiB <= 0 {
		return fmt.Errorf("GOSU_RUNNER_MAX_GPU_MEMORY_MIB must be positive when GPU devices are approved")
	}
	if len(c.ApprovedGPUDevices) == 0 && c.MaxGPUMemoryMiB != 0 {
		return fmt.Errorf("GOSU_RUNNER_MAX_GPU_MEMORY_MIB requires at least one GOSU_RUNNER_GPU_DEVICES entry")
	}
	if strings.TrimSpace(c.PolicyHash) == "" || len(c.PolicyHash) < 8 || len(c.PolicyHash) > 160 {
		return fmt.Errorf("GOSU_RUNNER_POLICY_HASH is invalid")
	}
	if c.ControlWebSocket != "" {
		u, err := url.Parse(c.ControlWebSocket)
		if err != nil || (u.Scheme != "ws" && u.Scheme != "wss") || u.Host == "" {
			return fmt.Errorf("GOSU_RUNNER_CONTROL_WS_URL must be an absolute ws:// or wss:// URL")
		}
		if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return fmt.Errorf("GOSU_RUNNER_CONTROL_WS_URL must not contain credentials, query parameters, or fragments")
		}
		if !runnerIDPattern.MatchString(c.ProjectID) {
			return fmt.Errorf("control requires a valid GOSU_RUNNER_PROJECT_ID")
		}
		loopback := isLoopbackHost(u.Hostname())
		if u.Scheme == "ws" && !loopback {
			return fmt.Errorf("non-loopback control connections require wss://")
		}
		if u.Scheme == "ws" {
			if !runnerIDPattern.MatchString(c.ControlLabID) {
				return fmt.Errorf("loopback ws:// control requires a valid GOSU_RUNNER_CONTROL_LAB_ID")
			}
		} else if c.ControlLabID != "" {
			return fmt.Errorf("GOSU_RUNNER_CONTROL_LAB_ID is only for loopback ws:// development control")
		}
		if c.ExecutionEnabled && !loopback && u.Scheme != "wss" {
			return fmt.Errorf("execution with non-loopback control requires wss://")
		}
	} else if c.ProjectID != "" || c.ControlLabID != "" {
		return fmt.Errorf("runner project and control lab IDs require GOSU_RUNNER_CONTROL_WS_URL")
	}
	return nil
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}

func signingKeys(raw string) (map[string]ed25519.PublicKey, error) {
	keys := make(map[string]ed25519.PublicKey)
	if strings.TrimSpace(raw) == "" {
		return keys, nil
	}
	for _, entry := range strings.Split(raw, ",") {
		keyID, encoded, ok := strings.Cut(strings.TrimSpace(entry), "=")
		if !ok || !runnerIDPattern.MatchString(keyID) || strings.TrimSpace(encoded) == "" {
			return nil, fmt.Errorf("GOSU_RUNNER_SIGNING_PUBLIC_KEYS entries must be key-id=base64-public-key")
		}
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("GOSU_RUNNER_SIGNING_PUBLIC_KEYS contains an invalid ed25519 public key for %s", keyID)
		}
		if _, duplicate := keys[keyID]; duplicate {
			return nil, fmt.Errorf("GOSU_RUNNER_SIGNING_PUBLIC_KEYS contains duplicate key ID %s", keyID)
		}
		keys[keyID] = ed25519.PublicKey(decoded)
	}
	return keys, nil
}

func value(lookup LookupEnv, key, fallback string) string {
	if raw, ok := lookup(key); ok {
		return strings.TrimSpace(raw)
	}
	return fallback
}

func csv(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	seen := make(map[string]struct{})
	values := make([]string, 0)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, ok := seen[part]; ok {
			continue
		}
		seen[part] = struct{}{}
		values = append(values, part)
	}
	return values
}

func boolean(lookup LookupEnv, key string, fallback bool) (bool, error) {
	raw, ok := lookup(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(strings.TrimSpace(raw))
	if err != nil {
		return false, fmt.Errorf("%s must be a boolean: %w", key, err)
	}
	return parsed, nil
}

func positiveFloat(lookup LookupEnv, key string, fallback float64) (float64, error) {
	raw, ok := lookup(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive number", key)
	}
	return parsed, nil
}

func positiveInt(lookup LookupEnv, key string, fallback int64) (int64, error) {
	raw, ok := lookup(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return parsed, nil
}

func nonnegativeInt(lookup LookupEnv, key string, fallback int64) (int64, error) {
	raw, ok := lookup(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || parsed < 0 {
		return 0, fmt.Errorf("%s must be a nonnegative integer", key)
	}
	return parsed, nil
}
