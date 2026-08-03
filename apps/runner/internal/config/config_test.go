package config

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestLoadSafeDefaults(t *testing.T) {
	cfg, err := Load(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ExecutionEnabled {
		t.Fatal("execution must be disabled by default")
	}
	if cfg.ControlWebSocket != "" {
		t.Fatalf("control URL = %q, want empty", cfg.ControlWebSocket)
	}
	if cfg.ListenAddress != "127.0.0.1:8088" {
		t.Fatalf("listen address = %q", cfg.ListenAddress)
	}
	if cfg.StopGrace != 15*time.Second {
		t.Fatalf("stop grace = %v", cfg.StopGrace)
	}
	if len(cfg.ApprovedGPUDevices) != 0 || cfg.MaxGPUMemoryMiB != 0 {
		t.Fatalf("GPU access must be disabled by default: %+v", cfg)
	}
}

func TestLoadExecutionRequiresImageAllowlist(t *testing.T) {
	environment := map[string]string{
		"GOSU_RUNNER_EXECUTION_ENABLED":   "true",
		"GOSU_RUNNER_SIGNING_PUBLIC_KEYS": testSigningKey(t),
	}
	_, err := Load(mapLookup(environment))
	if err == nil {
		t.Fatal("Load() error = nil, want image allowlist error")
	}
}

func TestLoadRejectsSecretBearingControlURL(t *testing.T) {
	for _, controlURL := range []string{
		"wss://control.invalid/ws?token=secret",
		"wss://user:password@control.invalid/ws",
	} {
		environment := map[string]string{
			"GOSU_RUNNER_CONTROL_WS_URL": controlURL,
			"GOSU_RUNNER_PROJECT_ID":     "project-vision",
		}
		_, err := Load(mapLookup(environment))
		if err == nil {
			t.Fatalf("Load() error = nil for secret-bearing URL %q, want rejection", controlURL)
		}
	}
}

func TestLoadLoopbackControlRequiresProjectAndDevelopmentLab(t *testing.T) {
	base := map[string]string{
		"GOSU_RUNNER_CONTROL_WS_URL": "ws://127.0.0.1:3001/v1/relay",
	}
	if _, err := Load(mapLookup(base)); err == nil {
		t.Fatal("Load() error = nil, want project ID requirement")
	}
	base["GOSU_RUNNER_PROJECT_ID"] = "project-vision"
	if _, err := Load(mapLookup(base)); err == nil {
		t.Fatal("Load() error = nil, want development lab ID requirement")
	}
	base["GOSU_RUNNER_CONTROL_LAB_ID"] = "lab-demo"
	cfg, err := Load(mapLookup(base))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ProjectID != "project-vision" || cfg.ControlLabID != "lab-demo" {
		t.Fatalf("unexpected control scope: %+v", cfg)
	}
}

func TestLoadRejectsNonLoopbackPlaintextControl(t *testing.T) {
	_, err := Load(mapLookup(map[string]string{
		"GOSU_RUNNER_CONTROL_WS_URL": "ws://control.invalid/v1/relay",
		"GOSU_RUNNER_PROJECT_ID":     "project-vision",
	}))
	if err == nil || !strings.Contains(err.Error(), "wss://") {
		t.Fatalf("Load() error = %v, want wss requirement", err)
	}
}

func TestLoadAcceptsProjectScopedRemoteWSSControl(t *testing.T) {
	cfg, err := Load(mapLookup(map[string]string{
		"GOSU_RUNNER_CONTROL_WS_URL": "wss://control.invalid/v1/relay",
		"GOSU_RUNNER_PROJECT_ID":     "project-vision",
	}))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.ProjectID != "project-vision" || cfg.ControlLabID != "" {
		t.Fatalf("unexpected control scope: %+v", cfg)
	}
}

func TestLoadRejectsNetworkEnablementWithoutEgressAdapter(t *testing.T) {
	_, err := Load(mapLookup(map[string]string{"GOSU_RUNNER_ALLOW_JOB_NETWORK": "true"}))
	if err == nil || !strings.Contains(err.Error(), "egress adapter") {
		t.Fatalf("Load() error = %v, want egress adapter rejection", err)
	}
}

func TestLoadRejectsLogUnsafeRunnerID(t *testing.T) {
	_, err := Load(mapLookup(map[string]string{"GOSU_RUNNER_ID": "runner\nforged-log"}))
	if err == nil {
		t.Fatal("Load() error = nil, want runner ID rejection")
	}
}

func TestLoadExecutionConfiguration(t *testing.T) {
	environment := map[string]string{
		"GOSU_RUNNER_EXECUTION_ENABLED":     "true",
		"GOSU_RUNNER_ALLOWED_IMAGE_DIGESTS": "sha256:" + strings.Repeat("a", 64) + ",sha256:" + strings.Repeat("b", 64),
		"GOSU_RUNNER_SIGNING_PUBLIC_KEYS":   testSigningKey(t),
		"GOSU_RUNNER_MAX_CPUS":              "8",
		"GOSU_RUNNER_GPU_DEVICES":           "nvidia.com/gpu=0,nvidia.com/gpu=GPU-a1b2-c3d4",
		"GOSU_RUNNER_MAX_GPU_MEMORY_MIB":    "24576",
	}
	cfg, err := Load(mapLookup(environment))
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.ExecutionEnabled || cfg.MaxCPUs != 8 || len(cfg.AllowedImageDigests) != 2 || len(cfg.SigningPublicKeys) != 1 || len(cfg.ApprovedGPUDevices) != 2 || cfg.MaxGPUMemoryMiB != 24576 {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestLoadRejectsBroadGPUSelector(t *testing.T) {
	_, err := Load(mapLookup(map[string]string{
		"GOSU_RUNNER_GPU_DEVICES":        "nvidia.com/gpu=all",
		"GOSU_RUNNER_MAX_GPU_MEMORY_MIB": "24576",
	}))
	if err == nil {
		t.Fatal("Load() error = nil, want broad GPU selector rejection")
	}
}

func TestLoadRequiresGPUMemoryLimitForApprovedDevices(t *testing.T) {
	_, err := Load(mapLookup(map[string]string{
		"GOSU_RUNNER_GPU_DEVICES": "nvidia.com/gpu=0",
	}))
	if err == nil {
		t.Fatal("Load() error = nil, want GPU memory limit requirement")
	}
}

func TestLoadRejectsInvalidSigningKey(t *testing.T) {
	_, err := Load(mapLookup(map[string]string{"GOSU_RUNNER_SIGNING_PUBLIC_KEYS": "key-id=not-base64"}))
	if err == nil {
		t.Fatal("Load() error = nil, want signing key error")
	}
}

func mapLookup(values map[string]string) LookupEnv {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}

func testSigningKey(t *testing.T) string {
	t.Helper()
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return "test-signing-key=" + base64.StdEncoding.EncodeToString(publicKey)
}
