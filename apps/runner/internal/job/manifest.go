package job

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"strings"
	"time"
)

const (
	EnvelopeSchemaVersion = 1
	ManifestSchemaVersion = 1
)

var (
	idempotencyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
	contentHashPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9:._-]{7,159}$`)
	digestPattern      = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	envPattern         = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,127}$`)
	secretRefPattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$`)
	secretLikeKey      = regexp.MustCompile(`(?i)(^|[^a-z0-9])(api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|secret|token|password|passwd|credential|authorization|auth)($|[^a-z0-9])`)
	secretLikeValues   = []*regexp.Regexp{
		regexp.MustCompile(`(?i)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----`),
		regexp.MustCompile(`(?i)(^|[[:space:]])Bearer[[:space:]]+[^[:space:]]+`),
		regexp.MustCompile(`^(sk|rk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}$`),
		regexp.MustCompile(`^AKIA[A-Z0-9]{16}$`),
	}
	forbiddenShells = map[string]struct{}{
		"bash": {}, "cmd": {}, "cmd.exe": {}, "dash": {}, "fish": {},
		"powershell": {}, "powershell.exe": {}, "pwsh": {}, "sh": {}, "zsh": {},
	}
)

// Envelope is runner transport metadata. It is deliberately outside the
// packages/contracts JobManifestV1 signature so leases can be renewed without
// re-signing an immutable experiment payload.
type Envelope struct {
	SchemaVersion  int      `json:"schemaVersion"`
	IdempotencyKey string   `json:"idempotencyKey"`
	Lease          Lease    `json:"lease"`
	Manifest       Manifest `json:"manifest"`
}

type Lease struct {
	ID         string    `json:"id"`
	FenceToken uint64    `json:"fenceToken"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

// Manifest mirrors packages/contracts JobManifestV1. The TypeScript Zod
// schema remains authoritative; this Go mirror is intentionally versioned.
type Manifest struct {
	SchemaVersion  int                `json:"schemaVersion"`
	JobID          string             `json:"jobId"`
	CampaignID     string             `json:"campaignId"`
	TrialID        string             `json:"trialId"`
	AttemptID      string             `json:"attemptId"`
	IssuedAt       time.Time          `json:"issuedAt"`
	CodeSHA        string             `json:"codeSha"`
	Image          Image              `json:"image"`
	Command        Command            `json:"command"`
	Parameters     map[string]any     `json:"parameters"`
	Seed           int64              `json:"seed"`
	Resources      Resources          `json:"resources"`
	Network        NetworkPolicy      `json:"network"`
	Mounts         []Mount            `json:"mounts"`
	SecretRefs     []SecretRef        `json:"secretRefs"`
	Execution      ContainerExecution `json:"execution"`
	TimeoutSeconds int64              `json:"timeoutSeconds"`
	Objective      ObjectiveSnapshot  `json:"objective"`
	PolicyVersion  int64              `json:"policyVersion"`
	PolicyHash     string             `json:"policyHash"`
	ManifestHash   string             `json:"manifestHash"`
	Signature      Signature          `json:"signature"`
}

type Image struct {
	Reference string `json:"reference"`
	Digest    string `json:"digest"`
}

type Command struct {
	Executable string   `json:"executable"`
	Args       []string `json:"args"`
}

type Resources struct {
	CPUCores     float64 `json:"cpuCores"`
	MemoryMiB    int64   `json:"memoryMiB"`
	GPUCount     int64   `json:"gpuCount"`
	GPUMemoryMiB *int64  `json:"gpuMemoryMiB"`
}

type NetworkPolicy struct {
	Mode         string   `json:"mode"`
	AllowedHosts []string `json:"allowedHosts"`
}

type Mount struct {
	Kind          string `json:"kind"`
	SourceRef     string `json:"sourceRef"`
	ContainerPath string `json:"containerPath"`
	ReadOnly      bool   `json:"readOnly"`
}

type SecretRef struct {
	Ref                 string `json:"ref"`
	EnvironmentVariable string `json:"environmentVariable"`
}

type ContainerExecution struct {
	Privileged             bool         `json:"privileged"`
	ReadOnlyRootFilesystem bool         `json:"readOnlyRootFilesystem"`
	NoNewPrivileges        bool         `json:"noNewPrivileges"`
	RunAsUser              int64        `json:"runAsUser"`
	RunAsGroup             int64        `json:"runAsGroup"`
	Capabilities           Capabilities `json:"capabilities"`
}

type Capabilities struct {
	Drop []string `json:"drop"`
	Add  []string `json:"add"`
}

type Signature struct {
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"keyId"`
	Value     string `json:"value"`
}

type ObjectiveSnapshot struct {
	ObjectiveVersionID string        `json:"objectiveVersionId"`
	Version            int64         `json:"version"`
	PrimaryMetric      PrimaryMetric `json:"primaryMetric"`
	Budget             Budget        `json:"budget"`
}

type PrimaryMetric struct {
	Key           string   `json:"key"`
	DisplayName   string   `json:"displayName"`
	Direction     string   `json:"direction"`
	Unit          *string  `json:"unit"`
	Aggregation   string   `json:"aggregation"`
	EvaluatorHash string   `json:"evaluatorHash"`
	DatasetHash   string   `json:"datasetHash"`
	HoldoutHash   *string  `json:"holdoutHash"`
	Baseline      *float64 `json:"baseline"`
	Target        *float64 `json:"target"`
}

type Budget struct {
	MaxTrials           int64   `json:"maxTrials"`
	MaxConcurrentTrials int64   `json:"maxConcurrentTrials"`
	MaxWallTimeSeconds  int64   `json:"maxWallTimeSeconds"`
	MaxGPUHours         float64 `json:"maxGpuHours"`
	MaxFailures         int64   `json:"maxFailures"`
}

func ReadEnvelopeFile(filename string, now time.Time) (Envelope, error) {
	data, err := os.ReadFile(filename)
	if err != nil {
		return Envelope{}, fmt.Errorf("read manifest envelope: %w", err)
	}
	return DecodeEnvelope(data, now)
}

func DecodeEnvelope(data []byte, now time.Time) (Envelope, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var envelope Envelope
	if err := decoder.Decode(&envelope); err != nil {
		return Envelope{}, fmt.Errorf("decode manifest envelope: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return Envelope{}, err
	}
	if err := envelope.Validate(now); err != nil {
		return Envelope{}, err
	}
	return envelope, nil
}

func (e Envelope) Digest() (string, error) {
	encoded, err := json.Marshal(e)
	if err != nil {
		return "", fmt.Errorf("encode envelope digest: %w", err)
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

func (e Envelope) Validate(now time.Time) error {
	if e.SchemaVersion != EnvelopeSchemaVersion {
		return fmt.Errorf("envelope schemaVersion must be %d", EnvelopeSchemaVersion)
	}
	if !idempotencyPattern.MatchString(e.IdempotencyKey) {
		return fmt.Errorf("idempotencyKey is invalid")
	}
	if err := validateEntityID("lease.id", e.Lease.ID); err != nil {
		return err
	}
	if e.Lease.FenceToken == 0 {
		return fmt.Errorf("lease.fenceToken must be positive")
	}
	if e.Lease.ExpiresAt.IsZero() || !e.Lease.ExpiresAt.After(now) {
		return fmt.Errorf("lease.expiresAt must be in the future")
	}
	return e.Manifest.Validate(now)
}

func (m Manifest) Validate(now time.Time) error {
	if m.SchemaVersion != ManifestSchemaVersion {
		return fmt.Errorf("manifest schemaVersion must be %d", ManifestSchemaVersion)
	}
	for name, value := range map[string]string{
		"jobId": m.JobID, "campaignId": m.CampaignID, "trialId": m.TrialID, "attemptId": m.AttemptID,
		"objective.objectiveVersionId": m.Objective.ObjectiveVersionID, "signature.keyId": m.Signature.KeyID,
	} {
		if err := validateEntityID(name, value); err != nil {
			return err
		}
	}
	if m.IssuedAt.IsZero() || m.IssuedAt.After(now.Add(5*time.Minute)) {
		return fmt.Errorf("issuedAt is invalid or too far in the future")
	}
	for name, value := range map[string]string{
		"codeSha": m.CodeSHA, "policyHash": m.PolicyHash,
		"objective.primaryMetric.evaluatorHash": m.Objective.PrimaryMetric.EvaluatorHash,
		"objective.primaryMetric.datasetHash":   m.Objective.PrimaryMetric.DatasetHash,
	} {
		if !contentHashPattern.MatchString(value) {
			return fmt.Errorf("%s is invalid", name)
		}
	}
	if m.Objective.PrimaryMetric.HoldoutHash != nil && !contentHashPattern.MatchString(*m.Objective.PrimaryMetric.HoldoutHash) {
		return fmt.Errorf("objective.primaryMetric.holdoutHash is invalid")
	}
	if strings.TrimSpace(m.Image.Reference) == "" || len(m.Image.Reference) > 512 || strings.ContainsAny(m.Image.Reference, "@\x00\r\n\t ") {
		return fmt.Errorf("image.reference is invalid")
	}
	if !digestPattern.MatchString(m.Image.Digest) {
		return fmt.Errorf("image.digest must be a sha256 digest")
	}
	if err := validateCommand(m.Command); err != nil {
		return err
	}
	if m.Parameters == nil {
		return fmt.Errorf("parameters must be an object")
	}
	if containsSecretLikeParameter(m.Parameters) {
		return fmt.Errorf("parameters contain secret-like data; use secretRefs")
	}
	if m.Resources.CPUCores <= 0 || m.Resources.MemoryMiB <= 0 || m.Resources.GPUCount < 0 {
		return fmt.Errorf("resources contain invalid limits")
	}
	if m.Resources.GPUMemoryMiB != nil && *m.Resources.GPUMemoryMiB < 0 {
		return fmt.Errorf("resources.gpuMemoryMiB must be nonnegative or null")
	}
	if m.Network.Mode != "none" && m.Network.Mode != "allowlist" {
		return fmt.Errorf("network.mode must be none or allowlist")
	}
	if m.Network.Mode == "none" && len(m.Network.AllowedHosts) != 0 {
		return fmt.Errorf("network.allowedHosts must be empty when mode is none")
	}
	for index, host := range m.Network.AllowedHosts {
		if strings.TrimSpace(host) == "" || len(host) > 253 || strings.ContainsAny(host, "/:@\x00\r\n\t ") {
			return fmt.Errorf("network.allowedHosts[%d] is invalid", index)
		}
	}
	for index, mount := range m.Mounts {
		if mount.Kind != "workspace" && mount.Kind != "dataset" && mount.Kind != "scratch" && mount.Kind != "host" {
			return fmt.Errorf("mounts[%d].kind is invalid", index)
		}
		if strings.TrimSpace(mount.SourceRef) == "" || len(mount.SourceRef) > 512 || strings.ContainsAny(mount.SourceRef, "\x00\r\n") {
			return fmt.Errorf("mounts[%d].sourceRef is invalid", index)
		}
		if !safeAbsoluteContainerPath(mount.ContainerPath) {
			return fmt.Errorf("mounts[%d].containerPath is invalid", index)
		}
	}
	for index, secret := range m.SecretRefs {
		if !secretRefPattern.MatchString(secret.Ref) || !envPattern.MatchString(secret.EnvironmentVariable) {
			return fmt.Errorf("secretRefs[%d] is invalid", index)
		}
	}
	if m.Execution.RunAsUser <= 0 || m.Execution.RunAsGroup <= 0 {
		return fmt.Errorf("execution user and group must be positive")
	}
	if m.TimeoutSeconds <= 0 || m.Objective.Version <= 0 || m.PolicyVersion <= 0 {
		return fmt.Errorf("timeoutSeconds, objective.version, and policyVersion must be positive")
	}
	if err := validateObjective(m.Objective); err != nil {
		return err
	}
	if !digestPattern.MatchString(m.ManifestHash) {
		return fmt.Errorf("manifestHash must be a sha256 digest")
	}
	if m.Signature.Algorithm != "ed25519" || strings.TrimSpace(m.Signature.Value) == "" || len(m.Signature.Value) > 512 {
		return fmt.Errorf("signature is invalid")
	}
	return nil
}

func validateCommand(command Command) error {
	if strings.TrimSpace(command.Executable) == "" || len(command.Executable) > 512 || strings.ContainsAny(command.Executable, "\x00\r\n") {
		return fmt.Errorf("command.executable is invalid")
	}
	if _, forbidden := forbiddenShells[path.Base(strings.ToLower(command.Executable))]; forbidden {
		return fmt.Errorf("command.executable must not invoke a shell")
	}
	if len(command.Args) > 512 {
		return fmt.Errorf("command.args exceeds 512 entries")
	}
	for index, argument := range command.Args {
		if len(argument) > 8192 || strings.ContainsRune(argument, '\x00') {
			return fmt.Errorf("command.args[%d] is invalid", index)
		}
		if secretLikeKey.MatchString(argument) || isSecretLikeValue(argument) {
			return fmt.Errorf("command.args[%d] contains secret-like data; use secretRefs", index)
		}
	}
	return nil
}

func containsSecretLikeParameter(value any) bool {
	switch typed := value.(type) {
	case string:
		return isSecretLikeValue(typed)
	case []any:
		for _, child := range typed {
			if containsSecretLikeParameter(child) {
				return true
			}
		}
	case map[string]any:
		for key, child := range typed {
			if secretLikeKey.MatchString(key) || containsSecretLikeParameter(child) {
				return true
			}
		}
	}
	return false
}

func isSecretLikeValue(value string) bool {
	trimmed := strings.TrimSpace(value)
	for _, pattern := range secretLikeValues {
		if pattern.MatchString(trimmed) {
			return true
		}
	}
	return false
}

func validateObjective(objective ObjectiveSnapshot) error {
	metric := objective.PrimaryMetric
	if strings.TrimSpace(metric.Key) == "" || len(metric.Key) > 128 || strings.TrimSpace(metric.DisplayName) == "" || len(metric.DisplayName) > 256 {
		return fmt.Errorf("objective.primaryMetric name is invalid")
	}
	if metric.Direction != "maximize" && metric.Direction != "minimize" {
		return fmt.Errorf("objective.primaryMetric.direction is invalid")
	}
	if metric.Aggregation != "mean" && metric.Aggregation != "median" && metric.Aggregation != "minimum" && metric.Aggregation != "maximum" && metric.Aggregation != "last" {
		return fmt.Errorf("objective.primaryMetric.aggregation is invalid")
	}
	budget := objective.Budget
	if budget.MaxTrials <= 0 || budget.MaxConcurrentTrials <= 0 || budget.MaxWallTimeSeconds <= 0 || budget.MaxGPUHours < 0 || budget.MaxFailures < 0 {
		return fmt.Errorf("objective.budget is invalid")
	}
	if budget.MaxConcurrentTrials > budget.MaxTrials {
		return fmt.Errorf("objective.budget.maxConcurrentTrials exceeds maxTrials")
	}
	return nil
}

func validateEntityID(name, value string) error {
	if strings.TrimSpace(value) == "" || value != strings.TrimSpace(value) || len(value) > 128 || strings.ContainsAny(value, "\x00\r\n") {
		return fmt.Errorf("%s is invalid", name)
	}
	return nil
}

func safeAbsoluteContainerPath(value string) bool {
	if value == "" || !strings.HasPrefix(value, "/") || strings.ContainsRune(value, '\x00') {
		return false
	}
	return path.Clean(value) == value
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err == io.EOF {
		return nil
	} else if err != nil {
		return fmt.Errorf("decode trailing JSON: %w", err)
	}
	return fmt.Errorf("manifest envelope must contain exactly one JSON object")
}
