from __future__ import annotations

from pathlib import Path

import pytest

from anumat_engine._binary import sidecar_env


def test_sidecar_env_points_napi_at_anydoc_next_to_the_binary(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    binary = tmp_path / "anumat-engine"
    native = tmp_path / "anydoc.node"
    binary.write_bytes(b"")
    native.write_bytes(b"native")
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", str(binary))
    env = sidecar_env({"KEEP": "1"})
    assert env["ANUMAT_ENGINE_SIDECAR"] == "1"
    assert env["NAPI_RS_NATIVE_LIBRARY_PATH"] == str(native)
    assert env["KEEP"] == "1"


def test_sidecar_env_omits_napi_when_anydoc_is_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    binary = tmp_path / "anumat-engine"
    binary.write_bytes(b"")
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", str(binary))
    monkeypatch.delenv("NAPI_RS_NATIVE_LIBRARY_PATH", raising=False)
    env = sidecar_env()
    assert env["ANUMAT_ENGINE_SIDECAR"] == "1"
    assert "NAPI_RS_NATIVE_LIBRARY_PATH" not in env
