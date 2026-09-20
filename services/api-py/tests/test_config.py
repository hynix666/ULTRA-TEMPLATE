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
