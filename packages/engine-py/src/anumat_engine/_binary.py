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


def native_library_path() -> Path | None:
    path = binary_path().parent / "anydoc.node"
    return path if path.is_file() else None


def sidecar_env(base: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy() if base is None else dict(base)
    env["ANUMAT_ENGINE_SIDECAR"] = "1"
    native = native_library_path()
    if native is not None:
        env["NAPI_RS_NATIVE_LIBRARY_PATH"] = str(native)
    return env
