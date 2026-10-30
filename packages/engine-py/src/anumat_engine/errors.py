from __future__ import annotations

from typing import Any


class EngineError(Exception):
    def __init__(self, message: str, *, code: str = "internal", details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details
