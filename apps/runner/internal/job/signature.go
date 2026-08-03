package job

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
)

var (
	ErrSigningKeyNotAllowed = errors.New("signing key is not allowed")
	ErrManifestHashMismatch = errors.New("manifest hash mismatch")
	ErrInvalidSignature     = errors.New("invalid manifest signature")
)

type Verifier struct {
	PublicKeys map[string]ed25519.PublicKey
}

func (v Verifier) Verify(manifest Manifest) error {
	publicKey, ok := v.PublicKeys[manifest.Signature.KeyID]
	if !ok {
		return fmt.Errorf("%w: %s", ErrSigningKeyNotAllowed, manifest.Signature.KeyID)
	}
	digest, err := manifest.ComputeHash()
	if err != nil {
		return err
	}
	if manifest.ManifestHash != digest.String() {
		return fmt.Errorf("%w: computed %s", ErrManifestHashMismatch, digest.String())
	}
	signature, err := base64.StdEncoding.DecodeString(manifest.Signature.Value)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return ErrInvalidSignature
	}
	if !ed25519.Verify(publicKey, digest[:], signature) {
		return ErrInvalidSignature
	}
	return nil
}

type Digest [sha256.Size]byte

func (d Digest) String() string {
	return "sha256:" + hex.EncodeToString(d[:])
}

func (m Manifest) ComputeHash() (Digest, error) {
	unsigned := m
	unsigned.ManifestHash = ""
	unsigned.Signature = Signature{}
	encoded, err := json.Marshal(unsigned)
	if err != nil {
		return Digest{}, fmt.Errorf("encode unsigned manifest: %w", err)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &object); err != nil {
		return Digest{}, fmt.Errorf("prepare unsigned manifest: %w", err)
	}
	delete(object, "manifestHash")
	delete(object, "signature")
	encoded, err = json.Marshal(object)
	if err != nil {
		return Digest{}, fmt.Errorf("encode unsigned manifest object: %w", err)
	}
	canonical, err := jsoncanonicalizer.Transform(encoded)
	if err != nil {
		return Digest{}, fmt.Errorf("canonicalize manifest: %w", err)
	}
	return sha256.Sum256(canonical), nil
}
