import pytest

from api_py.config import ConfigError, load_config, parse_duration_ms


def test_the_defaults_match_api_go_and_api_ts() -> None:
    config = load_config({})
    assert (config.port, config.shutdown_timeout_ms) == (8080, 10_000)


def test_port_is_read_the_way_go_reads_it() -> None:
    assert load_config({"PORT": "9000"}).port == 9000
    for bad in ["0", "65536", "-1", "8e3", "0x1F90", " 8080", "8080 ", "eighty", "80.5"]:
        with pytest.raises(ConfigError):
            load_config({"PORT": bad})


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("10s", 10_000),
        ("1m30s", 90_000),
        ("500ms", 500),
        (".5s", 500),
        ("1.s", 1000),
        ("+10s", 10_000),
        ("250us", 0.25),
        ("250µs", 0.25),
        ("250μs", 0.25),
        ("400ns", 0.0004),
        ("1h2m3s", 3_723_000),
    ],
)
def test_durations_follow_gos_grammar(raw: str, expected: float) -> None:
    assert parse_duration_ms(raw) == pytest.approx(expected)


def test_a_timeout_that_is_not_a_positive_duration_is_refused() -> None:
    for bad in ["0s", "-5s", "10", "10 s", "s", "10sec", "abc"]:
        with pytest.raises(ConfigError):
            load_config({"SHUTDOWN_TIMEOUT": bad})
    # An empty value is an unset value, as it is in api-go and api-ts.
    assert load_config({"SHUTDOWN_TIMEOUT": ""}).shutdown_timeout_ms == 10_000
    # Sub-millisecond is still positive, as it is in Go: not rounded away.
    assert load_config({"SHUTDOWN_TIMEOUT": "400ns"}).shutdown_timeout_ms == pytest.approx(0.0004)


def test_a_bad_value_names_the_variable_and_what_was_given() -> None:
    with pytest.raises(ConfigError, match=r'PORT must be an integer from 1 to 65535, got "banana"'):
        load_config({"PORT": "banana"})
    with pytest.raises(ConfigError, match=r"SHUTDOWN_TIMEOUT must be a positive duration"):
        load_config({"SHUTDOWN_TIMEOUT": "nope"})


# Where each script's digits start, so the look-alike values are built rather than written invisibly.
FULLWIDTH_ZERO = 0xFF10
ARABIC_INDIC_ZERO = 0x0660


def in_digits(text: str, zero: int) -> str:
    """text with its ASCII digits written in the script whose zero is at code point `zero`."""
    return "".join(chr(zero + int(c)) if "0" <= c <= "9" else c for c in text)


def test_only_ascii_digits_are_digits_as_go_reads_them() -> None:
    # Python's \d, int() and float() take any script's digits, and $ matches before a final newline;
    # Go's strconv.Atoi and time.ParseDuration take 0-9 and nothing after the value.
    for bad in [in_digits("8080", FULLWIDTH_ZERO), in_digits("8080", ARABIC_INDIC_ZERO), "8080\n"]:
        with pytest.raises(ConfigError):
            load_config({"PORT": bad})
    for bad in [in_digits("10s", FULLWIDTH_ZERO), "1" + in_digits("0s", ARABIC_INDIC_ZERO), "10s\n"]:
        with pytest.raises(ConfigError):
            load_config({"SHUTDOWN_TIMEOUT": bad})


def test_a_timeout_longer_than_go_can_hold_is_refused() -> None:
    # Go's time.Duration is an int64 of nanoseconds, so api-go refuses anything past about 292 years.
    assert load_config({"SHUTDOWN_TIMEOUT": "2562047h"}).shutdown_timeout_ms == 2562047 * 3_600_000
    with pytest.raises(ConfigError):
        load_config({"SHUTDOWN_TIMEOUT": "2562048h"})
