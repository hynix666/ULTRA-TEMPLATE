"""Configuration, read once at startup, refusing values it cannot use rather than defaulting silently.

Variable names and formats match api-go and api-ts, so all three services deploy the same way.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

DEFAULT_PORT: Final = 8080
DEFAULT_SHUTDOWN_TIMEOUT_MS: Final = 10_000

_UNIT_MS: Final[dict[str, float]] = {
    "h": 3_600_000,
    "m": 60_000,
    "s": 1000,
    "ms": 1,
    "us": 0.001,
    "µs": 0.001,
    "μs": 0.001,
    "ns": 0.000_001,
}

# The grammar of Go's time.ParseDuration: an optional sign, then one or more numbers ("1", "1.",
# ".5", "1.5") each followed by a unit. Longer units come first so "ms" is not read as "m".
_PART = r"(\d+\.?\d*|\.\d+)(ns|us|µs|μs|ms|h|m|s)"
_DURATION = re.compile(rf"^[-+]?(?:{_PART})+$")
_PORT = re.compile(r"^[+-]?\d+$")


class ConfigError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Config:
    port: int
    shutdown_timeout_ms: float


def parse_duration_ms(raw: str) -> float | None:
    """Go's duration syntax — 10s, 1m30s, .5s, 500ms, 250us — or None when the text is not one.

    Not rounded: a sub-millisecond timeout is still positive, as it is in Go.
    """
    if _DURATION.match(raw) is None:
        return None
    total = 0.0
    for amount, unit in re.findall(_PART, raw):
        total += float(amount) * _UNIT_MS[unit]
    return -total if raw.startswith("-") else total


def load_config(env: Mapping[str, str]) -> Config:
    raw_port = env.get("PORT", "")
    # Digits only, as Go's strconv.Atoi reads them: int() would also accept "_8080" and " 8080".
    port = DEFAULT_PORT if raw_port == "" else (int(raw_port) if _PORT.match(raw_port) else -1)
    if not 1 <= port <= 65535:
        raise ConfigError(f'PORT must be an integer from 1 to 65535, got "{raw_port}"')

    raw_timeout = env.get("SHUTDOWN_TIMEOUT", "")
    timeout = DEFAULT_SHUTDOWN_TIMEOUT_MS if raw_timeout == "" else parse_duration_ms(raw_timeout)
    if timeout is None or timeout <= 0:
        raise ConfigError(
            f'SHUTDOWN_TIMEOUT must be a positive duration such as 10s, 1m30s or 500ms, got "{raw_timeout}"'
        )

    return Config(port=port, shutdown_timeout_ms=timeout)
