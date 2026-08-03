package testfixture

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"strings"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/job"
)

const SigningKeyID = "test-signing-key"

func Envelope(now time.Time) job.Envelope {
	unit := "score"
	envelope := job.Envelope{
		SchemaVersion:  1,
		IdempotencyKey: "submit-test-001",
		Lease: job.Lease{
			ID: "lease-test-001", FenceToken: 1, ExpiresAt: now.Add(time.Hour),
		},
		Manifest: job.Manifest{
			SchemaVersion: 1,
			JobID:         "job-test-001",
			CampaignID:    "campaign-test-001",
			TrialID:       "trial-test-001",
			AttemptID:     "attempt-test-001",
			IssuedAt:      now.Add(-time.Minute),
			CodeSHA:       "sha256:" + strings.Repeat("a", 64),
			Image: job.Image{
				Reference: "docker.io/library/python:3.12-slim",
				Digest:    "sha256:" + strings.Repeat("0", 64),
			},
			Command:    job.Command{Executable: "python3", Args: []string{"train.py", "--epochs", "1"}},
			Parameters: map[string]any{"learningRate": 0.01},
			Seed:       7,
			Resources:  job.Resources{CPUCores: 1, MemoryMiB: 512, GPUCount: 0, GPUMemoryMiB: nil},
			Network:    job.NetworkPolicy{Mode: "none", AllowedHosts: []string{}},
			Mounts: []job.Mount{{
				Kind: "workspace", SourceRef: "job-source", ContainerPath: "/workspace", ReadOnly: false,
			}},
			SecretRefs: []job.SecretRef{},
			Execution: job.ContainerExecution{
				Privileged: false, ReadOnlyRootFilesystem: true, NoNewPrivileges: true,
				RunAsUser: 1000, RunAsGroup: 1000,
				Capabilities: job.Capabilities{Drop: []string{"ALL"}, Add: []string{}},
			},
			TimeoutSeconds: 60,
			Objective: job.ObjectiveSnapshot{
				ObjectiveVersionID: "objective-version-test-001",
				Version:            1,
				PrimaryMetric: job.PrimaryMetric{
					Key: "score", DisplayName: "Score", Direction: "maximize", Unit: &unit,
					Aggregation: "last", EvaluatorHash: "sha256:" + strings.Repeat("b", 64),
					DatasetHash: "sha256:" + strings.Repeat("c", 64),
				},
				Budget: job.Budget{
					MaxTrials: 10, MaxConcurrentTrials: 1, MaxWallTimeSeconds: 3600,
					MaxGPUHours: 0, MaxFailures: 2,
				},
			},
			PolicyVersion: 1,
			PolicyHash:    "local-policy-v1",
			Signature:     job.Signature{Algorithm: "ed25519", KeyID: SigningKeyID},
		},
	}
	Sign(&envelope.Manifest)
	return envelope
}

func Sign(manifest *job.Manifest) {
	manifest.ManifestHash = ""
	manifest.Signature.Algorithm = "ed25519"
	manifest.Signature.KeyID = SigningKeyID
	manifest.Signature.Value = ""
	digest, err := manifest.ComputeHash()
	if err != nil {
		panic(err)
	}
	manifest.ManifestHash = digest.String()
	manifest.Signature.Value = base64.StdEncoding.EncodeToString(ed25519.Sign(PrivateKey(), digest[:]))
}

func PublicKey() ed25519.PublicKey {
	return PrivateKey().Public().(ed25519.PublicKey)
}

func PrivateKey() ed25519.PrivateKey {
	seed := bytes.Repeat([]byte{0x42}, ed25519.SeedSize)
	return ed25519.NewKeyFromSeed(seed)
}
