package policy

import (
	"crypto/ed25519"
	"strings"
	"testing"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/job"
	"github.com/gosu-research/gosu/apps/runner/internal/testfixture"
)

func TestEvaluateAllowsSignedBoundedEnvelope(t *testing.T) {
	envelope := testfixture.Envelope(time.Now())
	decision := fixturePolicy().Evaluate(envelope)
	if !decision.Allowed {
		t.Fatalf("decision = %+v", decision)
	}
}

func TestEvaluateAllowsApprovedGPUWithinBudget(t *testing.T) {
	envelope := testfixture.Envelope(time.Now())
	gpuMemoryMiB := int64(8192)
	envelope.Manifest.Resources.GPUCount = 1
	envelope.Manifest.Resources.GPUMemoryMiB = &gpuMemoryMiB
	envelope.Manifest.Objective.Budget.MaxGPUHours = 1
	testfixture.Sign(&envelope.Manifest)
	decision := fixturePolicy().Evaluate(envelope)
	if !decision.Allowed {
		t.Fatalf("decision = %+v", decision)
	}
}

func TestEvaluateRejectsSignatureAndSecurityViolations(t *testing.T) {
	tests := []struct {
		name   string
		code   string
		mutate func(*job.Envelope, *Policy)
		resign bool
	}{
		{name: "unknown signing key", code: "signing_key_not_allowed", mutate: func(envelope *job.Envelope, _ *Policy) { envelope.Manifest.Signature.KeyID = "unknown-key" }},
		{name: "tampered manifest", code: "manifest_hash_mismatch", mutate: func(envelope *job.Envelope, _ *Policy) { envelope.Manifest.Command.Args[0] = "tampered.py" }},
		{name: "disabled", code: "execution_disabled", resign: true, mutate: func(_ *job.Envelope, policy *Policy) { policy.ExecutionEnabled = false }},
		{name: "image digest", code: "image_digest_not_allowed", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) {
			envelope.Manifest.Image.Digest = "sha256:" + strings.Repeat("f", 64)
		}},
		{name: "privileged", code: "privileged_container_forbidden", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) { envelope.Manifest.Execution.Privileged = true }},
		{name: "host mount", code: "host_mount_forbidden", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) { envelope.Manifest.Mounts[0].Kind = "host" }},
		{name: "docker socket", code: "container_socket_forbidden", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) {
			envelope.Manifest.Mounts[0].ContainerPath = "/var/run/docker.sock"
		}},
		{name: "secret ref", code: "secret_ref_not_allowed", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) {
			envelope.Manifest.SecretRefs = []job.SecretRef{{Ref: "unapproved-secret", EnvironmentVariable: "API_TOKEN"}}
		}},
		{name: "network", code: "network_egress_enforcement_unavailable", resign: true, mutate: func(envelope *job.Envelope, policy *Policy) {
			envelope.Manifest.Network = job.NetworkPolicy{Mode: "allowlist", AllowedHosts: []string{"example.invalid"}}
			policy.AllowNetwork = true
			policy.AllowedNetworkHosts = []string{"example.invalid"}
		}},
		{name: "memory", code: "memory_limit_exceeded", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) { envelope.Manifest.Resources.MemoryMiB = 4096 }},
		{name: "GPU memory without device", code: "gpu_memory_without_device", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) {
			gpuMemoryMiB := int64(1024)
			envelope.Manifest.Resources.GPUMemoryMiB = &gpuMemoryMiB
		}},
		{name: "GPU count", code: "gpu_count_limit_exceeded", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) {
			gpuMemoryMiB := int64(8192)
			envelope.Manifest.Resources.GPUCount = 2
			envelope.Manifest.Resources.GPUMemoryMiB = &gpuMemoryMiB
			envelope.Manifest.Objective.Budget.MaxGPUHours = 2
		}},
		{name: "GPU memory required", code: "gpu_memory_required", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) {
			envelope.Manifest.Resources.GPUCount = 1
			envelope.Manifest.Objective.Budget.MaxGPUHours = 1
		}},
		{name: "GPU memory", code: "gpu_memory_limit_exceeded", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) {
			gpuMemoryMiB := int64(32768)
			envelope.Manifest.Resources.GPUCount = 1
			envelope.Manifest.Resources.GPUMemoryMiB = &gpuMemoryMiB
			envelope.Manifest.Objective.Budget.MaxGPUHours = 1
		}},
		{name: "GPU-hour budget", code: "gpu_hour_budget_exceeded", resign: true, mutate: func(envelope *job.Envelope, _ *Policy) {
			gpuMemoryMiB := int64(8192)
			envelope.Manifest.Resources.GPUCount = 1
			envelope.Manifest.Resources.GPUMemoryMiB = &gpuMemoryMiB
			envelope.Manifest.TimeoutSeconds = 3600
			envelope.Manifest.Objective.Budget.MaxGPUHours = 0.5
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			envelope := testfixture.Envelope(time.Now())
			policy := fixturePolicy()
			test.mutate(&envelope, &policy)
			if test.resign {
				testfixture.Sign(&envelope.Manifest)
			}
			decision := policy.Evaluate(envelope)
			if decision.Allowed || decision.Code != test.code {
				t.Fatalf("decision = %+v, want code %q", decision, test.code)
			}
		})
	}
}

func fixturePolicy() Policy {
	return Policy{
		ExecutionEnabled: true,
		Verifier: job.Verifier{PublicKeys: map[string]ed25519.PublicKey{
			testfixture.SigningKeyID: testfixture.PublicKey(),
		}},
		PolicyVersion: 1, PolicyHash: "local-policy-v1",
		AllowedImageDigests: []string{"sha256:" + strings.Repeat("0", 64)},
		AllowedExecutables:  []string{"python3"},
		AllowedSecretRefs:   []string{"approved-secret"},
		ApprovedGPUDevices:  []string{"nvidia.com/gpu=0"},
		MaxCPUs:             2, MaxMemoryMiB: 2048, MaxPIDs: 256, MaxRuntimeSeconds: 600,
		MaxGPUMemoryMiB: 24576,
	}
}
