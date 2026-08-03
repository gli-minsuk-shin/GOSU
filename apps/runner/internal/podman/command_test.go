package podman

import (
	"strings"
	"testing"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/job"
	"github.com/gosu-research/gosu/apps/runner/internal/testfixture"
)

func TestRunBuildsStructuredRootlessCommand(t *testing.T) {
	manifest := testfixture.Envelope(time.Now()).Manifest
	manifest.SecretRefs = []job.SecretRef{
		{Ref: "z-secret", EnvironmentVariable: "Z_SECRET"},
		{Ref: "a-secret", EnvironmentVariable: "A_SECRET"},
	}
	command, err := (Builder{Binary: "podman", MaxPIDs: 256}).Run(manifest, t.TempDir())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if command.Name != "podman" || len(command.Args) == 0 || command.Args[0] != "run" {
		t.Fatalf("command = %+v", command)
	}
	joined := strings.Join(command.Args, "\x00")
	for _, required := range []string{
		"--userns=keep-id", "--security-opt=no-new-privileges", "--cap-drop=all",
		"--read-only", "--network=none", "--user\x001000:1000",
	} {
		if !strings.Contains(joined, required) {
			t.Errorf("command args missing %q: %#v", required, command.Args)
		}
	}
	if strings.Contains(joined, "sh\x00-c") || strings.Contains(joined, "bash\x00-c") {
		t.Fatalf("command contains shell execution: %#v", command.Args)
	}
	if strings.Contains(joined, "not-a-real-secret") {
		t.Fatalf("command contains a secret value: %#v", command.Args)
	}
	if strings.Index(joined, "a-secret,type=env,target=A_SECRET") > strings.Index(joined, "z-secret,type=env,target=Z_SECRET") {
		t.Fatalf("secret references are not sorted: %#v", command.Args)
	}
	if !strings.Contains(joined, manifest.Image.Reference+"@"+manifest.Image.Digest) {
		t.Fatalf("image reference is not digest-pinned: %#v", command.Args)
	}
}

func TestStopAndKillCommandsAreArgumentArrays(t *testing.T) {
	builder := Builder{Binary: "podman", MaxPIDs: 128}
	stop := builder.Stop("job:test", 5*time.Second)
	if got := strings.Join(stop.Args[:3], "|"); got != "stop|--time|5" || stop.Args[3] != ContainerName("job:test") {
		t.Fatalf("stop args = %#v", stop.Args)
	}
	kill := builder.Kill("job:test")
	if len(kill.Args) != 2 || kill.Args[0] != "kill" || kill.Args[1] != ContainerName("job:test") {
		t.Fatalf("kill args = %#v", kill.Args)
	}
}

func TestRunAddsOnlyApprovedConcreteGPUDevices(t *testing.T) {
	manifest := testfixture.Envelope(time.Now()).Manifest
	gpuMemoryMiB := int64(8192)
	manifest.Resources.GPUCount = 1
	manifest.Resources.GPUMemoryMiB = &gpuMemoryMiB
	builder := Builder{
		Binary:             "podman",
		MaxPIDs:            128,
		ApprovedGPUDevices: []string{"nvidia.com/gpu=GPU-a1b2-c3d4", "nvidia.com/gpu=1"},
	}
	command, err := builder.Run(manifest, t.TempDir())
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	joined := strings.Join(command.Args, "\x00")
	if !strings.Contains(joined, "--device\x00nvidia.com/gpu=GPU-a1b2-c3d4") {
		t.Fatalf("command args missing approved GPU selector: %#v", command.Args)
	}
	if strings.Contains(joined, "nvidia.com/gpu=1") {
		t.Fatalf("command mapped more GPUs than requested: %#v", command.Args)
	}
}

func TestRunRejectsGPUCountBeyondApprovedDevices(t *testing.T) {
	manifest := testfixture.Envelope(time.Now()).Manifest
	manifest.Resources.GPUCount = 1
	_, err := (Builder{Binary: "podman", MaxPIDs: 128}).Run(manifest, t.TempDir())
	if err == nil {
		t.Fatal("Run() error = nil, want GPU allowlist rejection")
	}
}

func TestRunRejectsNetworkAllowlistWithoutEgressAdapter(t *testing.T) {
	manifest := testfixture.Envelope(time.Now()).Manifest
	manifest.Network = job.NetworkPolicy{Mode: "allowlist", AllowedHosts: []string{"example.invalid"}}
	_, err := (Builder{Binary: "podman", MaxPIDs: 128}).Run(manifest, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "egress adapter") {
		t.Fatalf("Run() error = %v, want fail-closed egress rejection", err)
	}
}

func TestContainerNameAvoidsSanitizationCollisions(t *testing.T) {
	first := ContainerName("job:a.b")
	second := ContainerName("job:a:b")
	if first == second {
		t.Fatalf("container names collided: %q", first)
	}
	if len(first) > 63 || len(second) > 63 {
		t.Fatalf("container name exceeds Podman limit: %q %q", first, second)
	}
}
