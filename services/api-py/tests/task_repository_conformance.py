"""The conformance suite for the TaskRepository port: the behaviour the service relies on from any store.

The in-memory store passes it, and a store that replaces it, such as a database adapter, runs the same
suite against a fresh database of its own: passing is what makes it a replacement rather than a rewrite.
It returns every way the stores differ from the port's contract, so its own test can show it failing a
broken store; a store's test asserts the list is empty.
"""

from __future__ import annotations

from collections.abc import Callable

from api_py.application.ports import TaskRepository
from api_py.domain.task import Task

NewRepository = Callable[[], TaskRepository]


def _task(task_id: str, title: str) -> Task:
    return Task(
        id=task_id,
        title=title,
        status="todo",
        created_at="2026-01-02T03:04:05.006Z",
        updated_at="2026-01-02T03:04:06.006Z",
    )


def _saved_is_got_back(new: NewRepository) -> str | None:
    repository = new()
    saved = _task("a", "first")
    repository.save(saved)
    got = repository.get("a")
    return None if got == saved else f"got {got!r}, saved {saved!r}"


def _missing_is_not_found(new: NewRepository) -> str | None:
    return None if new().get("missing") is None else "found a task that was never saved"


def _empty_lists_nothing(new: NewRepository) -> str | None:
    listed = new().list()
    return None if len(listed) == 0 else f"listed {len(listed)} tasks"


def _oldest_first(new: NewRepository) -> str | None:
    repository = new()
    for saved in (_task("a", "first"), _task("b", "second"), _task("c", "third"), _task("a", "first, renamed")):
        repository.save(saved)
    listed = ", ".join(f"{task.id}={task.title}" for task in repository.list())
    return None if listed == "a=first, renamed, b=second, c=third" else f"listed {listed}, want a (renamed), b, c"


def _stores_share_nothing(new: NewRepository) -> str | None:
    first, second = new(), new()
    first.save(_task("a", "only in the first"))
    return None if second.get("a") is None else "the second store finds a task saved in the first"


CASES: tuple[tuple[str, Callable[[NewRepository], str | None]], ...] = (
    ("a saved task is got back as it was saved", _saved_is_got_back),
    ("a task never saved is not found", _missing_is_not_found),
    ("an empty store lists nothing", _empty_lists_nothing),
    ("tasks are listed oldest first, and a task saved again keeps its place", _oldest_first),
    ("two stores share nothing", _stores_share_nothing),
)


def check_task_repository(new: NewRepository) -> list[str]:
    """Every way the stores ``new`` returns differ from the port's contract; each must be empty and its own."""
    problems: list[str] = []
    for name, run in CASES:
        problem = run(new)
        if problem is not None:
            problems.append(f"{name}: {problem}")
    return problems
