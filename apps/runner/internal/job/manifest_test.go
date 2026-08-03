package job_test

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/job"
	"github.com/gosu-research/gosu/apps/runner/internal/testfixture"
)

func TestSampleEnvelopeMatchesGoMirrorAndSignature(t *testing.T) {
	now := time.Date(2026, time.August, 3, 0, 0, 0, 0, time.UTC)
	envelope, err := job.ReadEnvelopeFile(filepath.Join("..", "..", "examples", "job-manifest.json"), now)
	if err != nil {
		t.Fatalf("ReadEnvelopeFile() error = %v", err)
	}
	publicKey, err := base64.StdEncoding.DecodeString("IVL40Zt5HSRFMkLhXy6rbLfP+ntqXtMAl5YOBpiB2xI=")
	if err != nil {
		t.Fatal(err)
	}
	verifier := job.Verifier{PublicKeys: map[string]ed25519.PublicKey{"test-signing-key": publicKey}}
	if err := verifier.Verify(envelope.Manifest); err != nil {
		t.Fatalf("sample signature verification: %v", err)
	}
}

func TestDecodeEnvelopeAndVerifySignature(t *testing.T) {
	now := time.Now().UTC()
	envelope := testfixture.Envelope(now)
	data, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := job.DecodeEnvelope(data, now)
	if err != nil {
		t.Fatalf("DecodeEnvelope() error = %v", err)
	}
	if err := (job.Verifier{PublicKeys: map[string]ed25519.PublicKey{}}).Verify(decoded.Manifest); err == nil {
		t.Fatal("Verify() with empty allowlist error = nil")
	}
}

func TestVerifierAcceptsAllowedKeyAndRejectsTampering(t *testing.T) {
	now := time.Now().UTC()
	envelope := testfixture.Envelope(now)
	verifier := job.Verifier{PublicKeys: map[string]ed25519.PublicKey{
		testfixture.SigningKeyID: testfixture.PublicKey(),
	}}
	if err := verifier.Verify(envelope.Manifest); err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	tampered := envelope.Manifest
	tampered.Command.Args = append([]string(nil), envelope.Manifest.Command.Args...)
	tampered.Command.Args[0] = "tampered.py"
	if err := verifier.Verify(tampered); !errors.Is(err, job.ErrManifestHashMismatch) {
		t.Fatalf("tampered Verify() error = %v, want hash mismatch", err)
	}
	badSignature := envelope.Manifest
	badSignature.Signature.Value = strings.Repeat("A", 88)
	if err := verifier.Verify(badSignature); !errors.Is(err, job.ErrInvalidSignature) {
		t.Fatalf("bad-signature Verify() error = %v", err)
	}
}

func TestDecodeRejectsUnknownFieldsAndTrailingJSON(t *testing.T) {
	now := time.Now().UTC()
	data, _ := json.Marshal(testfixture.Envelope(now))
	unknown := strings.Replace(string(data), `"schemaVersion":1`, `"unknown":true,"schemaVersion":1`, 1)
	if _, err := job.DecodeEnvelope([]byte(unknown), now); err == nil {
		t.Fatal("DecodeEnvelope() error = nil, want unknown-field error")
	}
	if _, err := job.DecodeEnvelope(append(data, []byte(` {}`)...), now); err == nil {
		t.Fatal("DecodeEnvelope() error = nil, want trailing-JSON error")
	}
}

func TestManifestRejectsShellUnsafeMountAndExpiredLease(t *testing.T) {
	now := time.Now().UTC()
	tests := []struct {
		name   string
		mutate func(*job.Envelope)
	}{
		{name: "shell", mutate: func(envelope *job.Envelope) { envelope.Manifest.Command.Executable = "bash" }},
		{name: "relative mount", mutate: func(envelope *job.Envelope) { envelope.Manifest.Mounts[0].ContainerPath = "workspace" }},
		{name: "expired", mutate: func(envelope *job.Envelope) { envelope.Lease.ExpiresAt = now.Add(-time.Second) }},
		{name: "bad digest", mutate: func(envelope *job.Envelope) { envelope.Manifest.Image.Digest = "sha256:short" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			envelope := testfixture.Envelope(now)
			test.mutate(&envelope)
			if err := envelope.Validate(now); err == nil {
				t.Fatal("Validate() error = nil")
			}
		})
	}
}

func TestManifestRejectsSecretLikeParametersAndArguments(t *testing.T) {
	now := time.Now().UTC()

	parameterEnvelope := testfixture.Envelope(now)
	parameterEnvelope.Manifest.Parameters = map[string]any{
		"optimizer": map[string]any{"api_token": "must-not-be-inline"},
	}
	testfixture.Sign(&parameterEnvelope.Manifest)
	encoded, err := json.Marshal(parameterEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := job.DecodeEnvelope(encoded, now); err == nil || !strings.Contains(err.Error(), "use secretRefs") {
		t.Fatalf("DecodeEnvelope() error = %v, want secretRefs rejection", err)
	}

	argumentEnvelope := testfixture.Envelope(now)
	argumentEnvelope.Manifest.Command.Args = append(argumentEnvelope.Manifest.Command.Args, "--api-key=must-not-be-inline")
	testfixture.Sign(&argumentEnvelope.Manifest)
	encoded, err = json.Marshal(argumentEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := job.DecodeEnvelope(encoded, now); err == nil || !strings.Contains(err.Error(), "use secretRefs") {
		t.Fatalf("DecodeEnvelope() error = %v, want secretRefs rejection", err)
	}
}

func TestStopAndKillStateSemantics(t *testing.T) {
	if status, err := job.RequestStop(job.StatusQueued); err != nil || status != job.StatusStopped {
		t.Fatalf("queued stop = %s, %v", status, err)
	}
	if status, err := job.RequestStop(job.StatusRunning); err != nil || status != job.StatusStopRequested {
		t.Fatalf("running stop = %s, %v", status, err)
	}
	if status, err := job.RequestKill(job.StatusStopRequested); err != nil || status != job.StatusKillRequested {
		t.Fatalf("stopping kill = %s, %v", status, err)
	}
	if _, err := job.RequestKill(job.StatusSucceeded); err == nil {
		t.Fatal("killing succeeded job should fail")
	}
}
