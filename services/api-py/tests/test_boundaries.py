"""Each rule must be seen to fire. A checker proven only on clean code passes just as well when broken."""

from __future__ import annotations

from pathlib import Path

from check_boundaries import check_file, check_tree


def test_the_domain_may_not_import_effects_packages_or_other_layers() -> None:
    assert len(check_file("domain/task.py", "import os")) == 1
    assert len(check_file("domain/task.py", "import json")) == 1
    assert len(check_file("domain/task.py", "from datetime import UTC")) == 1
    assert len(check_file("domain/task.py", "import httpx")) == 1
    assert len(check_file("domain/task.py", "from api_py.application.ports import Clock")) == 1
    # Pure standard-library modules and its own package are what remains.
    assert check_file("domain/task.py", "from dataclasses import dataclass\nimport re") == []
    assert check_file("domain/task.py", "from api_py.domain.other import thing") == []
    assert check_file("domain/task.py", "from .other import thing") == []
    assert len(check_file("domain/task.py", "from ..adapters.http import create_app")) == 1


def test_the_application_may_not_reach_adapters_or_the_composition_root() -> None:
    multiline = "from api_py.adapters.http import (\n    create_app,\n)"
    assert len(check_file("application/task_service.py", multiline)) == 1
    assert len(check_file("application/task_service.py", "from api_py.config import Config")) == 1
    assert len(check_file("application/task_service.py", "import threading")) == 1
    assert check_file("application/task_service.py", "from api_py.domain.task import Task") == []


def test_adapters_may_use_anything_except_the_composition_root() -> None:
    assert check_file("adapters/http.py", "import json\nimport threading\nimport httpx") == []
    assert len(check_file("adapters/http.py", "from api_py.main import app")) == 1


def test_a_module_outside_every_layer_fails_unless_it_is_the_composition_root() -> None:
    assert len(check_file("infrastructure/db.py", "import os")) == 1
    assert len(check_file("helpers.py", "x = 1")) == 1
    assert check_file("main.py", "import os\nfrom api_py.adapters.http import create_app") == []
    assert check_file("config.py", "import re") == []


def test_an_import_hidden_in_a_string_is_not_an_import() -> None:
    # ast parses; a regex would report this line and teach people to distrust the check.
    assert check_file("domain/task.py", 'DOC = "import os"\n# import json') == []


def test_the_real_source_tree_has_no_violations() -> None:
    files, problems = check_tree(Path(__file__).resolve().parent.parent)
    assert files > 0
    assert problems == []
