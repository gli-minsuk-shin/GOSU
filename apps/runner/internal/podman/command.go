package podman

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/gpu"
	"github.com/gosu-research/gosu/apps/runner/internal/job"
)

type Command struct {
	Name string
	Args []string
}

type Builder struct {
	Binary             string
	MaxPIDs            int64
	ApprovedGPUDevices []string
}

func (b Builder) Run(manifest job.Manifest, workspaceDirectory string) (Command, error) {
	if b.Binary == "" {
		return Command{}, fmt.Errorf("podman binary must not be empty")
	}
	if b.MaxPIDs <= 0 {
		return Command{}, fmt.Errorf("Podman PID limit must be positive")
	}
	absoluteWorkspace, err := filepath.Abs(workspaceDirectory)
	if err != nil {
		return Command{}, fmt.Errorf("resolve workspace directory: %w", err)
	}
	containerName := ContainerName(manifest.JobID)
	args := []string{
		"run", "--rm",
		"--name", containerName,
		"--userns=keep-id",
		"--security-opt=no-new-privileges",
		"--cap-drop=all",
		"--pids-limit", strconv.FormatInt(b.MaxPIDs, 10),
		"--cpus", strconv.FormatFloat(manifest.Resources.CPUCores, 'f', -1, 64),
		"--memory", fmt.Sprintf("%dm", manifest.Resources.MemoryMiB),
		"--user", fmt.Sprintf("%d:%d", manifest.Execution.RunAsUser, manifest.Execution.RunAsGroup),
		"--workdir", "/workspace",
		"--mount", fmt.Sprintf("type=bind,src=%s,dst=/workspace,rw", absoluteWorkspace),
		"--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=512m",
	}
	if manifest.Execution.ReadOnlyRootFilesystem {
		args = append(args, "--read-only")
	}
	if manifest.Network.Mode != "none" {
		return Command{}, fmt.Errorf("job networking requires an enforceable egress adapter")
	}
	args = append(args, "--network=none")
	selectedGPUDevices, err := gpu.Select(b.ApprovedGPUDevices, manifest.Resources.GPUCount)
	if err != nil {
		return Command{}, fmt.Errorf("select GPU devices: %w", err)
	}
	for _, selector := range selectedGPUDevices {
		args = append(args, "--device", selector)
	}
	secretRefs := append([]job.SecretRef(nil), manifest.SecretRefs...)
	sort.Slice(secretRefs, func(left, right int) bool {
		return secretRefs[left].EnvironmentVariable < secretRefs[right].EnvironmentVariable
	})
	for _, secret := range secretRefs {
		args = append(args, "--secret", fmt.Sprintf("%s,type=env,target=%s", secret.Ref, secret.EnvironmentVariable))
	}
	args = append(args, manifest.Image.Reference+"@"+manifest.Image.Digest, manifest.Command.Executable)
	args = append(args, manifest.Command.Args...)
	return Command{Name: b.Binary, Args: args}, nil
}

func (b Builder) Stop(jobID string, grace time.Duration) Command {
	seconds := int64(grace.Round(time.Second) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	return Command{
		Name: b.Binary,
		Args: []string{"stop", "--time", strconv.FormatInt(seconds, 10), ContainerName(jobID)},
	}
}

func (b Builder) Kill(jobID string) Command {
	return Command{Name: b.Binary, Args: []string{"kill", ContainerName(jobID)}}
}

func ContainerName(jobID string) string {
	var builder strings.Builder
	for _, character := range strings.ToLower(jobID) {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '-' || character == '_' {
			builder.WriteRune(character)
		} else {
			builder.WriteRune('-')
		}
	}
	readable := strings.Trim(builder.String(), "-")
	if readable == "" {
		readable = "job"
	}
	digest := sha256.Sum256([]byte(jobID))
	suffix := hex.EncodeToString(digest[:])[:10]
	const maximumReadableLength = 47
	if len(readable) > maximumReadableLength {
		readable = readable[:maximumReadableLength]
	}
	return "gosu-" + readable + "-" + suffix
}
