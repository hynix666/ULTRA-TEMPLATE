"""The ports this layer needs, declared by the consumer that uses them.

They are ``Protocol`` classes, so an adapter satisfies one by shape and never imports this module to
say so — the dependency points inward, which is the rule ``scripts/check_boundaries.py`` enforces.
"""

from __future__ import annotations

from typing import Protocol

from api_py.domain.task import Task


class TaskRepository(Protocol):
    """Storage. ``get`` returns None for a missing task; the service decides what that means."""

    def save(self, task: Task) -> None: ...

    def get(self, task_id: str) -> Task | None: ...

    def list(self) -> tuple[Task, ...]: ...


class Clock(Protocol):
    """The clock is a port: a service that read the wall clock itself could not be tested exactly."""

    def now(self) -> str: ...


class IdGenerator(Protocol):
    """So is the id source, for the same reason."""

    def next(self) -> str: ...
