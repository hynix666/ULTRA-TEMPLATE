import json

import pytest

from api_py.main import run


def test_a_refused_configuration_is_one_json_line_naming_the_variable(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("PORT", "eighty")
    assert run() == 2
    line = json.loads(capsys.readouterr().out)
    assert (line["level"], line["msg"]) == ("error", "invalid configuration")
    assert "PORT" in line["error"]
