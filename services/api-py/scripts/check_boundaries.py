"""The import-boundary rule for this service, checked over every source file instead of left to review.

Each layer lists what it MAY import. An allowlist, because a denylist only forbids the mistakes its
author already thought of:

    api_py/domain       its own package, and only standard-library modules that are themselves pure
    api_py/application  the domain, its own package, and the same pure modules
    api_py/adapters     the domain, the application, its own package, any module, any package
    api_py/main.py and api_py/config.py are the composition root and may import anything
    any other module under api_py/ belongs to no layer, and fails

Below the composition root no module reads a clock, draws randomness or reads the environment
(EFFECTS): each is injected, as a clock, an id source or a mapping of settings, which is what lets every
layer be tested without them. The adapters may import anything, so this is the rule that keeps them to it.

Imports and names are read with ``ast``, the same parser Python itself uses, so a name inside a string or
a comment cannot raise a false alarm and no import can hide from it, renamed or not.

    uv run python scripts/check_boundaries.py

Exit 0 clean, 1 violations.
"""

from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path

PACKAGE = "api_py"

# Standard-library modules with no I/O, no clock and no randomness. Everything else — os, time,
# random, json, threading, pathlib — belongs to an adapter or the composition root.
PURE_STDLIB = frozenset({"__future__", "abc", "collections", "collections.abc", "dataclasses", "enum", "re", "typing"})

COMPOSITION_ROOT = frozenset({"main.py", "config.py"})

# What only the composition root may use: modules that are nothing but randomness, and the functions of
# other modules that read a clock, a random source or the environment.
EFFECT_MODULES = frozenset({"random", "secrets"})
EFFECTS = frozenset(
    {
        "time.time",
        "time.time_ns",
        "time.monotonic",
        "time.monotonic_ns",
        "time.perf_counter",
        "time.perf_counter_ns",
        "datetime.now",
        "datetime.utcnow",
        "datetime.today",
        "date.today",
        "os.environ",
        "os.environb",
        "os.getenv",
        "uuid.uuid1",
        "uuid.uuid4",
    }
)


@dataclass(frozen=True, slots=True)
class Layer:
    package: str
    may_import: frozenset[str]
    anything: bool = False


LAYERS = (
    Layer("domain", frozenset({"domain"})),
    Layer("application", frozenset({"domain", "application"})),
    Layer("adapters", frozenset({"domain", "application", "adapters"}), anything=True),
)


def imported_modules(source: str, relative: str) -> list[str]:
    """Every module this source imports, as an absolute dotted name.

    A relative import is resolved against the importing file first. `from .other import x` stays in
    the layer, but `from ..adapters import x` leaves it, and only resolution can tell them apart.
    """
    tree = ast.parse(source)
    here = f"{PACKAGE}.{relative.rsplit('/', 1)[0]}" if "/" in relative else PACKAGE
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0:
                names.append(node.module or "")
                continue
            parts = here.split(".")
            base = parts[: len(parts) - (node.level - 1)]
            names.append(".".join([*base, *([node.module] if node.module else [])]) or PACKAGE)
    return [name for name in names if name != ""]


def effects(source: str) -> list[str]:
    """Every clock, random source or environment this source reaches, as the dotted name it uses."""
    tree = ast.parse(source)
    # What each local name stands for: `import time as clock` makes clock mean time, and
    # `from datetime import datetime` makes datetime mean datetime.datetime, whose now is datetime.now.
    names: dict[str, str] = {}
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in EFFECT_MODULES:
                    found.append(f"import {alias.name}")
                names[alias.asname or alias.name] = alias.name
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module.split(".")[0] in EFFECT_MODULES:
                found.append(f"from {node.module} import ...")
            for alias in node.names:
                dotted = f"{node.module.rsplit('.', 1)[-1]}.{alias.name}"
                if dotted in EFFECTS:
                    found.append(dotted)
                names[alias.asname or alias.name] = alias.name if node.module == alias.name else dotted
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            # The whole chain, its first name resolved, so datetime.datetime.now reads as datetime.now.
            parts = [node.attr]
            value = node.value
            while isinstance(value, ast.Attribute):
                parts.insert(0, value.attr)
                value = value.value
            if not isinstance(value, ast.Name):
                continue
            chain = [*names.get(value.id, value.id).split("."), *parts]
            if ".".join(chain[-2:]) in EFFECTS:
                found.append(".".join(chain[-2:]))
    return found


def check_file(relative: str, source: str) -> list[str]:
    """Violations in one file. ``relative`` is POSIX and rooted at the package, e.g. domain/task.py."""
    head = relative.split("/")[0]
    layer = next((one for one in LAYERS if one.package == head), None)
    if layer is None:
        if relative in COMPOSITION_ROOT:
            return []
        return [
            f"{relative} belongs to no layer. Move it into "
            f"{', '.join(one.package for one in LAYERS)}, or add a layer with its own allowlist."
        ]

    problems: list[str] = [
        f"{relative} uses {effect}; below the composition root it is injected. Take it as a parameter "
        f"from {sorted(COMPOSITION_ROOT)[0]}."
        for effect in effects(source)
    ]
    for module in imported_modules(source, relative):
        if module == PACKAGE or module.startswith(f"{PACKAGE}."):
            target = module[len(PACKAGE) + 1 :].split(".")[0]
            if target not in layer.may_import:
                problems.append(
                    f"{relative} imports {module}; {layer.package} may import only "
                    f"{', '.join(sorted(layer.may_import))}."
                )
        elif not layer.anything and module.split(".")[0] not in PURE_STDLIB and module not in PURE_STDLIB:
            problems.append(
                f"{relative} imports {module}; {layer.package} performs no I/O and may import only "
                f"pure modules ({', '.join(sorted(PURE_STDLIB))}). Put the integration in an adapter."
            )
    return problems


def check_tree(root: Path) -> tuple[int, list[str]]:
    package_root = root / "src" / PACKAGE
    files = sorted(path for path in package_root.rglob("*.py") if path.name != "__init__.py")
    problems: list[str] = []
    for path in files:
        relative = path.relative_to(package_root).as_posix()
        problems.extend(check_file(relative, path.read_text(encoding="utf-8")))
    return len(files), problems


def main() -> int:
    files, problems = check_tree(Path(__file__).resolve().parent.parent)
    if problems:
        print(f"check-boundaries: {len(problems)} violation(s)\n", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    print(f"check-boundaries: OK. {files} files, 0 violations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
