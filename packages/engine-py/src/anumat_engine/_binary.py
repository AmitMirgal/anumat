from __future__ import annotations

import os
import sys
from pathlib import Path

from anumat_engine.errors import EngineError


def binary_path() -> Path:
    override = os.environ.get("ANUMAT_ENGINE_BINARY")
    if override:
        path = Path(override)
        if not path.is_file():
            raise EngineError(f"ANUMAT_ENGINE_BINARY does not exist: {path}", code="internal")
        return path
    name = "anumat-engine.exe" if sys.platform == "win32" else "anumat-engine"
    path = Path(__file__).resolve().parent / "bin" / name
    if not path.is_file():
        raise EngineError(f"anumat-engine binary is not installed at {path}", code="internal")
    return path
