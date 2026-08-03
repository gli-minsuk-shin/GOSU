package policy

import (
	"errors"
	"path"
	"strings"

	"github.com/gosu-research/gosu/apps/runner/internal/job"
)

type Policy struct {
	ExecutionEnabled    bool
	Verifier            job.Verifier
	PolicyVersion       int64
	PolicyHash          string
	AllowedImageDigests []string
	AllowedExecutables  []string
	AllowedSecretRefs   []string
	AllowedNetworkHosts []string
	ApprovedGPUDevices  []string
	AllowNetwork        bool
	MaxCPUs             float64
	MaxMemoryMiB        int64
	MaxPIDs             int64
	MaxGPUMemoryMiB     int64
	MaxRuntimeSeconds   int64
}

type Decision struct {
	Allowed bool   `json:"allowed"`
	Code    string `json:"code,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

func (p Policy) Evaluate(envelope job.Envelope) Decision {
	manifest := envelope.Manifest
	if err := p.Verifier.Verify(manifest); err != nil {
		switch {
		case errors.Is(err, job.ErrSigningKeyNotAllowed):
			return reject("signing_key_not_allowed", "manifest signing key is not on the runner allowlist")
		case errors.Is(err, job.ErrManifestHashMismatch):
			return reject("manifest_hash_mismatch", "manifest content does not match manifestHash")
		default:
			return reject("invalid_signature", "manifest ed25519 signature verification failed")
		}
	}
	if manifest.PolicyVersion != p.PolicyVersion || manifest.PolicyHash != p.PolicyHash {
		return reject("policy_mismatch", "manifest was approved under a different runner policy")
	}
	if !p.ExecutionEnabled {
		return reject("execution_disabled", "local execution is disabled by runner configuration")
	}
	if !contains(manifest.Image.Digest, p.AllowedImageDigests) {
		return reject("image_digest_not_allowed", "container image digest is not on the runner allowlist")
	}
	if !contains(path.Base(manifest.Command.Executable), p.AllowedExecutables) {
		return reject("executable_not_allowed", "command executable is not on the runner allowlist")
	}
	if manifest.Execution.Privileged {
		return reject("privileged_container_forbidden", "privileged containers are forbidden")
	}
	if !manifest.Execution.ReadOnlyRootFilesystem {
		return reject("writable_rootfs_forbidden", "container root filesystem must be read-only")
	}
	if !manifest.Execution.NoNewPrivileges {
		return reject("no_new_privileges_required", "noNewPrivileges must be enabled")
	}
	if len(manifest.Execution.Capabilities.Add) != 0 || !containsFold("ALL", manifest.Execution.Capabilities.Drop) {
		return reject("capability_policy_rejected", "all capabilities must be dropped and none may be added")
	}
	workspaceMounts := 0
	for _, mount := range manifest.Mounts {
		if containsSocketReference(mount.SourceRef) || containsSocketReference(mount.ContainerPath) {
			return reject("container_socket_forbidden", "Docker and Podman sockets must not be mounted")
		}
		if mount.Kind == "host" {
			return reject("host_mount_forbidden", "host mounts are forbidden")
		}
		if mount.Kind != "workspace" {
			return reject("mount_kind_not_supported", "dataset and scratch resolvers are not available in this runner skeleton")
		}
		workspaceMounts++
		if mount.ContainerPath != "/workspace" || mount.SourceRef != "job-source" || mount.ReadOnly {
			return reject("workspace_mount_invalid", "workspace mount must map local job-source read-write at /workspace")
		}
	}
	if workspaceMounts != 1 {
		return reject("workspace_mount_required", "exactly one workspace mount is required")
	}
	for _, secret := range manifest.SecretRefs {
		if !contains(secret.Ref, p.AllowedSecretRefs) {
			return reject("secret_ref_not_allowed", "manifest references a secret outside the runner allowlist")
		}
	}
	if manifest.Network.Mode != "none" {
		return reject("network_egress_enforcement_unavailable", "job networking remains disabled until an enforceable egress adapter is configured")
	}
	if manifest.Resources.GPUCount == 0 {
		if manifest.Resources.GPUMemoryMiB != nil && *manifest.Resources.GPUMemoryMiB != 0 {
			return reject("gpu_memory_without_device", "GPU memory cannot be requested without a GPU device")
		}
	} else {
		if manifest.Resources.GPUCount > int64(len(p.ApprovedGPUDevices)) {
			return reject("gpu_count_limit_exceeded", "job GPU request exceeds the runner CDI device allowlist")
		}
		if manifest.Resources.GPUMemoryMiB == nil || *manifest.Resources.GPUMemoryMiB <= 0 {
			return reject("gpu_memory_required", "GPU jobs must declare a positive GPU memory requirement")
		}
		if *manifest.Resources.GPUMemoryMiB > p.MaxGPUMemoryMiB {
			return reject("gpu_memory_limit_exceeded", "job GPU memory request exceeds the runner limit")
		}
		requestedGPUHours := float64(manifest.Resources.GPUCount) * float64(manifest.TimeoutSeconds) / 3600
		if requestedGPUHours > manifest.Objective.Budget.MaxGPUHours {
			return reject("gpu_hour_budget_exceeded", "job timeout and GPU count exceed the approved objective GPU-hour budget")
		}
	}
	if manifest.Resources.CPUCores > p.MaxCPUs {
		return reject("cpu_limit_exceeded", "job CPU request exceeds the runner limit")
	}
	if manifest.Resources.MemoryMiB > p.MaxMemoryMiB {
		return reject("memory_limit_exceeded", "job memory request exceeds the runner limit")
	}
	if manifest.TimeoutSeconds > p.MaxRuntimeSeconds {
		return reject("runtime_limit_exceeded", "job runtime request exceeds the runner limit")
	}
	return Decision{Allowed: true}
}

func reject(code, reason string) Decision {
	return Decision{Allowed: false, Code: code, Reason: reason}
}

func contains(value string, allowed []string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func containsFold(value string, allowed []string) bool {
	for _, candidate := range allowed {
		if strings.EqualFold(value, candidate) {
			return true
		}
	}
	return false
}

func containsSocketReference(value string) bool {
	lower := strings.ToLower(value)
	return strings.Contains(lower, "docker.sock") || strings.Contains(lower, "podman.sock") || strings.Contains(lower, "/run/docker") || strings.Contains(lower, "/run/podman")
}
