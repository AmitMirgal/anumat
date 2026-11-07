from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from release_fakes import FakeRegistry, sha256_bytes

ROOT = Path(__file__).resolve().parents[3]
REGISTRY = ROOT / "scripts" / "release" / "registry.py"


def _run(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    merged.update(env)
    return subprocess.run(
        ["python3", str(REGISTRY), *args],
        cwd=ROOT,
        env=merged,
        text=True,
        capture_output=True,
        check=False,
    )


def test_pypi_absent_and_present_and_network_fail_closed(tmp_path: Path) -> None:
    registry = FakeRegistry()
    registry.start()
    try:
        registry.set_pypi("anumat-engine", "0.1.2", 200, {"urls": []})
        env = {"ANUMAT_PYPI_INDEX": registry.pypi_index()}
        present = _run(["pypi-status", "--name", "anumat-engine", "--version", "0.1.2"], env)
        assert present.returncode == 0, present.stderr
        assert present.stdout.strip() == "present"
        absent = _run(["pypi-status", "--name", "anumat-engine", "--version", "9.9.9"], env)
        assert absent.returncode == 0, absent.stderr
        assert absent.stdout.strip() == "absent"
        auth = _run(
            ["pypi-status", "--name", "anumat-engine", "--version", "0.1.2"],
            {"ANUMAT_PYPI_INDEX": registry.pypi_index()},
        )
        assert auth.returncode == 0
        registry.set_pypi("anumat-engine", "0.1.3", 500, {"error": "nope"})
        server_error = _run(["pypi-status", "--name", "anumat-engine", "--version", "0.1.3"], env)
        assert server_error.returncode == 2
        assert "HTTP 500" in server_error.stderr
        down = _run(
            ["pypi-status", "--name", "anumat-engine", "--version", "0.1.2"],
            {"ANUMAT_PYPI_INDEX": "http://127.0.0.1:1/pypi"},
        )
        assert down.returncode == 2
        assert "network error" in down.stderr
        registry.set_pypi("anumat-engine", "0.1.4", 429, {"error": "slow"})
        limited = _run(["pypi-status", "--name", "anumat-engine", "--version", "0.1.4"], env)
        assert limited.returncode == 2
        assert "429" in limited.stderr
    finally:
        registry.stop()


def test_pypi_plan_new_partial_complete_and_mismatch(tmp_path: Path) -> None:
    one = tmp_path / "anumat_engine-0.1.2-py3-none-manylinux_2_17_x86_64.whl"
    two = tmp_path / "anumat_engine-0.1.2.tar.gz"
    one.write_bytes(b"wheel-a")
    two.write_bytes(b"sdist-a")
    registry = FakeRegistry()
    registry.start()
    env = {"ANUMAT_PYPI_INDEX": registry.pypi_index()}
    try:
        new = _run(
            ["pypi-plan", "--name", "anumat-engine", "--version", "0.1.2", str(one), str(two)],
            env,
        )
        assert new.returncode == 0, new.stderr
        plan = json.loads(new.stdout)
        assert plan["state"] == "new"
        assert plan["to_upload"] == [str(one), str(two)]

        registry.set_pypi(
            "anumat-engine",
            "0.1.2",
            200,
            {
                "urls": [
                    {
                        "filename": one.name,
                        "digests": {"sha256": sha256_bytes(b"wheel-a")},
                    }
                ]
            },
        )
        partial = _run(
            ["pypi-plan", "--name", "anumat-engine", "--version", "0.1.2", str(one), str(two)],
            env,
        )
        assert partial.returncode == 0, partial.stderr
        plan = json.loads(partial.stdout)
        assert plan["state"] == "partial"
        assert plan["matched"] == [str(one)]
        assert plan["to_upload"] == [str(two)]

        registry.set_pypi(
            "anumat-engine",
            "0.1.2",
            200,
            {
                "urls": [
                    {"filename": one.name, "digests": {"sha256": sha256_bytes(b"wheel-a")}},
                    {"filename": two.name, "digests": {"sha256": sha256_bytes(b"sdist-a")}},
                ]
            },
        )
        complete = _run(
            ["pypi-plan", "--name", "anumat-engine", "--version", "0.1.2", str(one), str(two)],
            env,
        )
        assert complete.returncode == 0, complete.stderr
        assert json.loads(complete.stdout)["state"] == "complete"
        assert json.loads(complete.stdout)["to_upload"] == []

        registry.set_pypi(
            "anumat-engine",
            "0.1.2",
            200,
            {
                "urls": [
                    {"filename": one.name, "digests": {"sha256": sha256_bytes(b"other")}},
                    {"filename": two.name, "digests": {"sha256": sha256_bytes(b"sdist-a")}},
                ]
            },
        )
        mismatch = _run(
            ["pypi-plan", "--name", "anumat-engine", "--version", "0.1.2", str(one), str(two)],
            env,
        )
        assert mismatch.returncode == 1
        assert "does not match local" in mismatch.stderr
        assert "Do not bump" in mismatch.stderr
    finally:
        registry.stop()


def test_pypi_plan_rejects_remote_file_missing_locally(tmp_path: Path) -> None:
    one = tmp_path / "anumat_py-0.1.2-py3-none-any.whl"
    one.write_bytes(b"wheel")
    registry = FakeRegistry()
    registry.start()
    try:
        registry.set_pypi(
            "anumat-py",
            "0.1.2",
            200,
            {
                "urls": [
                    {"filename": one.name, "digests": {"sha256": sha256_bytes(b"wheel")}},
                    {
                        "filename": "anumat_py-0.1.2.tar.gz",
                        "digests": {"sha256": sha256_bytes(b"sdist")},
                    },
                ]
            },
        )
        result = _run(
            ["pypi-plan", "--name", "anumat-py", "--version", "0.1.2", str(one)],
            {"ANUMAT_PYPI_INDEX": registry.pypi_index()},
        )
        assert result.returncode == 1
        assert "anumat_py-0.1.2.tar.gz" in result.stderr
    finally:
        registry.stop()


def test_npm_compare_match_and_mismatch() -> None:
    registry = FakeRegistry()
    registry.start()
    env = {"ANUMAT_NPM_REGISTRY": registry.npm_registry()}
    try:
        registry.set_npm(
            "@anumat/js",
            "1.0.2",
            200,
            {"dist": {"integrity": "sha512-abc", "shasum": "deadbeef"}},
        )
        match = _run(
            [
                "compare-npm",
                "--name",
                "@anumat/js",
                "--version",
                "1.0.2",
                "--integrity",
                "sha512-abc",
                "--shasum",
                "deadbeef",
            ],
            env,
        )
        assert match.returncode == 0, match.stderr
        mismatch = _run(
            [
                "compare-npm",
                "--name",
                "@anumat/js",
                "--version",
                "1.0.2",
                "--integrity",
                "sha512-other",
                "--shasum",
                "deadbeef",
            ],
            env,
        )
        assert mismatch.returncode == 1
        assert "integrity" in mismatch.stderr
        missing = _run(
            ["npm-status", "--name", "@anumat/engine", "--version", "9.9.9"],
            env,
        )
        assert missing.returncode == 0
        assert missing.stdout.strip() == "absent"
        registry.set_npm("@anumat/engine", "0.2.0", 401, {"error": "nope"})
        auth = _run(["npm-status", "--name", "@anumat/engine", "--version", "0.2.0"], env)
        assert auth.returncode == 2
        assert "authentication" in auth.stderr
    finally:
        registry.stop()
