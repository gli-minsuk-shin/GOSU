package testfixture

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/job"
)

func TestFixtureVerifies(t *testing.T) {
	envelope := Envelope(time.Date(2026, time.August, 3, 0, 0, 0, 0, time.UTC))
	if err := envelope.Validate(time.Date(2026, time.August, 3, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("fixture validation: %v", err)
	}
	verifier := job.Verifier{PublicKeys: map[string]ed25519.PublicKey{SigningKeyID: PublicKey()}}
	if err := verifier.Verify(envelope.Manifest); err != nil {
		t.Fatalf("fixture signature: %v", err)
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("public_key=%s", base64.StdEncoding.EncodeToString(PublicKey()))
	t.Logf("envelope=%s", encoded)
}
