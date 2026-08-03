package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gosu-research/gosu/apps/runner/internal/config"
	"github.com/gosu-research/gosu/apps/runner/internal/control"
	"github.com/gosu-research/gosu/apps/runner/internal/events"
	"github.com/gosu-research/gosu/apps/runner/internal/health"
	"github.com/gosu-research/gosu/apps/runner/internal/job"
	"github.com/gosu-research/gosu/apps/runner/internal/podman"
	"github.com/gosu-research/gosu/apps/runner/internal/policy"
	"github.com/gosu-research/gosu/apps/runner/internal/runner"
	"github.com/gosu-research/gosu/apps/runner/internal/store"
)

func main() {
	validateManifest := flag.String("validate-manifest", "", "validate a JobManifest JSON file and exit")
	flag.Parse()

	cfg, err := config.Load(os.LookupEnv)
	if err != nil {
		log.Fatalf("configuration error: %v", err)
	}
	if *validateManifest != "" {
		envelope, err := job.ReadEnvelopeFile(*validateManifest, time.Now())
		if err != nil {
			log.Fatalf("manifest validation failed: %v", err)
		}
		if err := (job.Verifier{PublicKeys: cfg.SigningPublicKeys}).Verify(envelope.Manifest); err != nil {
			log.Fatalf("manifest signature verification failed: %v", err)
		}
		result := struct {
			Valid             bool   `json:"valid"`
			SignatureVerified bool   `json:"signature_verified"`
			JobID             string `json:"job_id"`
		}{Valid: true, SignatureVerified: true, JobID: envelope.Manifest.JobID}
		_ = json.NewEncoder(os.Stdout).Encode(result)
		return
	}

	jobStore, err := store.Open(filepath.Join(cfg.StateDirectory, "store"))
	if err != nil {
		log.Fatalf("open job store: %v", err)
	}
	eventSpool, err := events.Open(filepath.Join(cfg.StateDirectory, "spool"))
	if err != nil {
		log.Fatalf("open event spool: %v", err)
	}
	controlHeaders := make(http.Header)
	if cfg.ControlLabID != "" {
		controlHeaders.Set("x-gosu-client-kind", "runner")
		controlHeaders.Set("x-gosu-lab", cfg.ControlLabID)
		controlHeaders.Set("x-gosu-sub", cfg.RunnerID)
		controlHeaders.Set("x-gosu-role", "project_lead")
	}
	controlClient := control.New(cfg.ControlWebSocket, controlHeaders)
	service := &runner.Service{
		RunnerID: cfg.RunnerID, ProjectID: cfg.ProjectID, StateDirectory: cfg.StateDirectory,
		Store: jobStore, Spool: eventSpool,
		Policy: policy.Policy{
			ExecutionEnabled: cfg.ExecutionEnabled,
			Verifier:         job.Verifier{PublicKeys: cfg.SigningPublicKeys},
			PolicyVersion:    cfg.PolicyVersion, PolicyHash: cfg.PolicyHash,
			AllowedImageDigests: cfg.AllowedImageDigests,
			AllowedExecutables:  cfg.AllowedExecutables,
			AllowedSecretRefs:   cfg.AllowedSecretRefs,
			AllowedNetworkHosts: cfg.AllowedNetworkHosts,
			ApprovedGPUDevices:  cfg.ApprovedGPUDevices,
			AllowNetwork:        cfg.AllowJobNetwork,
			MaxCPUs:             cfg.MaxCPUs, MaxMemoryMiB: cfg.MaxMemoryMB, MaxPIDs: cfg.MaxPIDs,
			MaxGPUMemoryMiB:   cfg.MaxGPUMemoryMiB,
			MaxRuntimeSeconds: int64(cfg.MaxRuntime / time.Second),
		},
		Podman: podman.Builder{Binary: cfg.PodmanBinary, MaxPIDs: cfg.MaxPIDs, ApprovedGPUDevices: cfg.ApprovedGPUDevices}, Executor: runner.OSCommandExecutor{},
		StopGrace: cfg.StopGrace,
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go func() {
		if err := controlClient.Run(ctx, service.HandleControl); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("control client stopped: %v", err)
		}
	}()
	go func() {
		if err := service.DeliverEvents(ctx, controlClient); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("event delivery stopped: %v", err)
		}
	}()

	mux := http.NewServeMux()
	mux.Handle("/healthz", health.Handler{
		RunnerID: cfg.RunnerID, ExecutionEnabled: cfg.ExecutionEnabled,
		Control: controlClient, Spool: eventSpool,
	})
	server := &http.Server{
		Addr:              cfg.ListenAddress,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownContext, shutdownCancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer shutdownCancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			log.Printf("HTTP shutdown: %v", err)
		}
	}()

	log.Printf("runner %s listening on %s (execution=%t, control=%s)", cfg.RunnerID, cfg.ListenAddress, cfg.ExecutionEnabled, controlClient.State())
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(fmt.Errorf("serve health endpoint: %w", err))
	}
	service.Wait()
}
