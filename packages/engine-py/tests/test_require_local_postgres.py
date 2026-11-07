from __future__ import annotations

import os
import socket
import stat
import subprocess
from pathlib import Path

import pytest

from test_policy_cases import POSTGRES_SETUP, _recreate_database

ROOT = Path(__file__).resolve().parents[3]
PREFLIGHT = ROOT / "scripts" / "require-local-postgres.sh"
RELEASE = ROOT / "scripts" / "release-engine-py.sh"


def _write_executable(path: Path, text: str) -> None:
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _run_preflight(host: str, port: int, bin_dir: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["ANUMAT_POSTGRES_HOST"] = host
    env["ANUMAT_POSTGRES_PORT"] = str(port)
    return subprocess.run(
        ["bash", str(PREFLIGHT)],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_preflight_fails_closed_when_nothing_listens(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker_log = tmp_path / "docker.log"
    _write_executable(
        bin_dir / "docker",
        f"#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> '{docker_log}'\nexit 99\n",
    )
    holder = socket.socket()
    holder.bind(("127.0.0.1", 0))
    port = holder.getsockname()[1]
    holder.close()
    result = _run_preflight("127.0.0.1", port, bin_dir)
    assert result.returncode == 1
    assert "Postgres is not accepting connections" in result.stderr
    assert "docker run -d --name anumat-postgres" in result.stderr
    assert "anumat_engine_parity" in result.stderr
    assert "does not start Postgres" in result.stderr
    assert not docker_log.exists()


def test_preflight_passes_when_port_accepts_tcp_without_starting_docker(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker_log = tmp_path / "docker.log"
    _write_executable(
        bin_dir / "docker",
        f"#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> '{docker_log}'\nexit 99\n",
    )
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    try:
        port = listener.getsockname()[1]
        result = _run_preflight("127.0.0.1", port, bin_dir)
    finally:
        listener.close()
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert not docker_log.exists()


def test_release_script_runs_preflight_before_pytest() -> None:
    script = RELEASE.read_text()
    assert "bash scripts/require-local-postgres.sh" in script
    assert script.index("bash scripts/require-local-postgres.sh") < script.index(
        "pnpm turbo run test --filter=anumat-engine"
    )
    for line in script.splitlines():
        if "git push" in line:
            assert line.lstrip().startswith("echo ")


def test_recreate_database_names_setup_when_psql_cannot_connect(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_args: object, **_kwargs: object) -> None:
        raise subprocess.CalledProcessError(2, ["psql"])

    monkeypatch.setattr("test_policy_cases.subprocess.check_call", boom)
    with pytest.raises(AssertionError, match="anumat_engine_parity") as raised:
        _recreate_database()
    assert "docker run -d --name anumat-postgres" in str(raised.value)
    assert raised.value.args[0] == POSTGRES_SETUP
    assert isinstance(raised.value.__cause__, subprocess.CalledProcessError)
