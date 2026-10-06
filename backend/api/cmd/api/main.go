package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"linkbook/api/internal/database"
	"linkbook/api/internal/httpapi"
)

// @title Linkbook API
// @version 0.1.0
// @description Linkbook user registration and process health.
// @BasePath /
func main() {
	if err := run(); err != nil {
		slog.Error("API stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	startupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	db, err := database.Open(startupCtx, os.Getenv("DATABASE_URL"))
	cancel()
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	slog.Info("PostgreSQL ready; migrations applied")

	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:              "127.0.0.1:" + port,
		Handler:           httpapi.NewHandler(db),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errorsCh := make(chan error, 1)
	go func() {
		slog.Info("API listening", "address", server.Addr)
		errorsCh <- server.ListenAndServe()
	}()

	select {
	case err := <-errorsCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		stop()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return err
		}
		slog.Info("API stopped gracefully")
		return nil
	}
}
