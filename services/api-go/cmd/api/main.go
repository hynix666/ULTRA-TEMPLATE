// Command api starts the task HTTP service.
package main

import (
	"context"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/hynix666/ultra-template/services/api-go/internal/app"
	"github.com/hynix666/ultra-template/services/api-go/internal/config"
)

func main() {
	os.Exit(run())
}

// run returns the exit code, so every deferred cleanup runs before the process exits.
func run() int {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.FromEnv(os.Getenv)
	if err != nil {
		log.Error("invalid configuration", "error", err)

		return 2
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", cfg.Addr())
	if err != nil {
		log.Error("cannot listen", "addr", cfg.Addr(), "error", err)

		return 1
	}

	if err := app.Serve(ctx, listener, cfg.ShutdownTimeout, log); err != nil {
		log.Error("service stopped with an error", "error", err)

		return 1
	}

	return 0
}
