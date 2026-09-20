// Package config reads the service configuration from the environment once, at startup, and
// refuses values it cannot use instead of falling back to a default silently.
package config

import (
	"fmt"
	"strconv"
	"time"
)

const (
	defaultPort            = 8080
	defaultShutdownTimeout = 10 * time.Second
	maxPort                = 65535
)

// Config is the validated service configuration.
type Config struct {
	Port            int
	ShutdownTimeout time.Duration
}

// FromEnv builds a Config from getenv: os.Getenv in production, a map lookup in tests.
func FromEnv(getenv func(string) string) (Config, error) {
	cfg := Config{Port: defaultPort, ShutdownTimeout: defaultShutdownTimeout}

	if raw := getenv("PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port < 1 || port > maxPort {
			return Config{}, fmt.Errorf("PORT must be an integer from 1 to %d, got %q", maxPort, raw)
		}

		cfg.Port = port
	}

	if raw := getenv("SHUTDOWN_TIMEOUT"); raw != "" {
		timeout, err := time.ParseDuration(raw)
		if err != nil || timeout <= 0 {
			return Config{}, fmt.Errorf("SHUTDOWN_TIMEOUT must be a positive duration such as 10s, got %q", raw)
		}

		cfg.ShutdownTimeout = timeout
	}

	return cfg, nil
}

// Addr is the address the HTTP server listens on.
func (c Config) Addr() string {
	return fmt.Sprintf(":%d", c.Port)
}
