from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from release_fakes import FakeRegistry, sha256_bytes, write_executable

ROOT = Path(__file__).resolve().parents[3]


def _env(
    bin_dir: Path,
    registry: FakeRegistry,
    extra: dict[str, str] | None = None,
    *,
    bash32: Path | None = None,
) -> dict[str, str]:
    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["ANUMAT_PYPI_INDEX"] = registry.pypi_index()
    env["ANUMAT_UV"] = str(bin_dir / "uv")
    env.pop("PYPI_TOKEN", None)
    if extra:
        env.update(extra)
    if bash32 is not None:
        # Non-interactive bash reads BASH_ENV before the script, so this
        # reproduces macOS 3.2 (no mapfile) on CI's bash 5.
        bash32.write_text("enable -n mapfile readarray 2>/dev/null || true\n")
        env["BASH_ENV"] = str(bash32)
    return env


def test_publish_uploads_only_missing_files(tmp_path: Path) -> None:
    wheel = tmp_path / "anumat_engine-0.1.2-py3-none-manylinux_2_17_x86_64.whl"
    sdist = tmp_path / "anumat_engine-0.1.2.tar.gz"
    wheel.write_bytes(b"wheel-a")
    sdist.write_bytes(b"sdist-a")
    log = tmp_path / "uv.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    write_executable(
        bin_dir / "uv",
        f"""#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> '{log}'
if [[ -z "${{UV_PUBLISH_TOKEN:-}}" ]]; then
  echo "missing UV_PUBLISH_TOKEN" >&2
  exit 4
fi
if [[ " $* " == *" --token "* ]]; then
  echo "token must not appear on argv" >&2
  exit 4
fi
""",
    )
    registry = FakeRegistry()
    registry.start()
    registry.set_pypi(
        "anumat-engine",
        "0.1.2",
        200,
        {
            "urls": [
                {"filename": wheel.name, "digests": {"sha256": sha256_bytes(b"wheel-a")}},
            ]
        },
    )
    try:
        result = subprocess.run(
            [
                "bash",
                str(ROOT / "scripts/release/publish-pypi.sh"),
                "anumat-engine",
                "0.1.2",
                str(wheel),
                str(sdist),
            ],
            cwd=ROOT,
            env=_env(bin_dir, registry, {"PYPI_TOKEN": "test-token"}, bash32=tmp_path / "disable-bash4.sh"),
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        uploaded = log.read_text().strip().splitlines()
        assert uploaded == [f"publish {sdist}"]
    finally:
        registry.stop()


def test_publish_is_noop_when_hashes_match(tmp_path: Path) -> None:
    wheel = tmp_path / "anumat_py-0.1.2-py3-none-any.whl"
    sdist = tmp_path / "anumat_py-0.1.2.tar.gz"
    wheel.write_bytes(b"w")
    sdist.write_bytes(b"s")
    log = tmp_path / "uv.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    write_executable(bin_dir / "uv", f"#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> '{log}'\nexit 99\n")
    registry = FakeRegistry()
    registry.start()
    registry.set_pypi(
        "anumat-py",
        "0.1.2",
        200,
        {
            "urls": [
                {"filename": wheel.name, "digests": {"sha256": sha256_bytes(b"w")}},
                {"filename": sdist.name, "digests": {"sha256": sha256_bytes(b"s")}},
            ]
        },
    )
    try:
        result = subprocess.run(
            ["bash", str(ROOT / "scripts/release/publish-pypi.sh"), "anumat-py", "0.1.2", str(wheel), str(sdist)],
            cwd=ROOT,
            env=_env(bin_dir, registry, {"PYPI_TOKEN": "test-token"}, bash32=tmp_path / "disable-bash4.sh"),
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        assert "already on PyPI" in result.stdout
        assert not log.exists()
    finally:
        registry.stop()


def test_publish_refuses_mismatch_without_calling_uv(tmp_path: Path) -> None:
    wheel = tmp_path / "anumat_py-0.1.2-py3-none-any.whl"
    wheel.write_bytes(b"local")
    log = tmp_path / "uv.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    write_executable(bin_dir / "uv", f"#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> '{log}'\nexit 0\n")
    registry = FakeRegistry()
    registry.start()
    registry.set_pypi(
        "anumat-py",
        "0.1.2",
        200,
        {"urls": [{"filename": wheel.name, "digests": {"sha256": sha256_bytes(b"remote")}}]},
    )
    try:
        result = subprocess.run(
            ["bash", str(ROOT / "scripts/release/publish-pypi.sh"), "anumat-py", "0.1.2", str(wheel)],
            cwd=ROOT,
            env=_env(bin_dir, registry, {"PYPI_TOKEN": "test-token"}, bash32=tmp_path / "disable-bash4.sh"),
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 1
        assert not log.exists()
    finally:
        registry.stop()


def test_finish_pypi_confirms_before_publish_and_can_tag_only(tmp_path: Path) -> None:
    repo = tmp_path / "git"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "release@example.test"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Release Test"], cwd=repo, check=True)
    (repo / "file").write_text("x\n")
    subprocess.run(["git", "add", "file"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "init"], cwd=repo, check=True)

    wheel = tmp_path / "anumat_py-0.1.2-py3-none-any.whl"
    sdist = tmp_path / "anumat_py-0.1.2.tar.gz"
    wheel.write_bytes(b"w")
    sdist.write_bytes(b"s")
    log = tmp_path / "uv.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    write_executable(
        bin_dir / "uv",
        f"""#!/usr/bin/env bash
printf '%s\\n' "$*" >> '{log}'
""",
    )
    registry = FakeRegistry()
    registry.start()
    registry.set_pypi(
        "anumat-py",
        "0.1.2",
        200,
        {
            "urls": [
                {"filename": wheel.name, "digests": {"sha256": sha256_bytes(b"w")}},
                {"filename": sdist.name, "digests": {"sha256": sha256_bytes(b"s")}},
            ]
        },
    )
    env = _env(bin_dir, registry)
    try:
        cancelled = subprocess.run(
            [
                "bash",
                str(ROOT / "scripts/release/finish-pypi.sh"),
                "anumat-py",
                "0.1.2",
                "anumat-py@0.1.2",
                str(wheel),
                str(sdist),
            ],
            cwd=repo,
            env=env,
            input="nope\n",
            text=True,
            capture_output=True,
            check=False,
        )
        assert cancelled.returncode == 1
        assert "Cancelled" in cancelled.stderr
        assert not log.exists()
        assert subprocess.run(["git", "tag"], cwd=repo, capture_output=True, text=True, check=True).stdout == ""

        tagged = subprocess.run(
            [
                "bash",
                str(ROOT / "scripts/release/finish-pypi.sh"),
                "anumat-py",
                "0.1.2",
                "anumat-py@0.1.2",
                str(wheel),
                str(sdist),
            ],
            cwd=repo,
            env=env,
            input="0.1.2\n",
            text=True,
            capture_output=True,
            check=False,
        )
        assert tagged.returncode == 0, tagged.stderr
        assert not log.exists()
        tags = subprocess.run(["git", "tag"], cwd=repo, capture_output=True, text=True, check=True).stdout
        assert "anumat-py@0.1.2" in tags
        assert "git push origin tag anumat-py@0.1.2" in tagged.stdout
        assert "does not push" in tagged.stdout
    finally:
        registry.stop()


def test_finish_pypi_partial_requires_token_after_confirm(tmp_path: Path) -> None:
    repo = tmp_path / "git"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "release@example.test"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Release Test"], cwd=repo, check=True)
    (repo / "file").write_text("x\n")
    subprocess.run(["git", "add", "file"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "init"], cwd=repo, check=True)
    wheel = tmp_path / "anumat_py-0.1.2-py3-none-any.whl"
    sdist = tmp_path / "anumat_py-0.1.2.tar.gz"
    wheel.write_bytes(b"w")
    sdist.write_bytes(b"s")
    log = tmp_path / "uv.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    write_executable(bin_dir / "uv", f"#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> '{log}'\n")
    registry = FakeRegistry()
    registry.start()
    registry.set_pypi(
        "anumat-py",
        "0.1.2",
        200,
        {"urls": [{"filename": wheel.name, "digests": {"sha256": sha256_bytes(b"w")}}]},
    )
    env = _env(bin_dir, registry)
    try:
        missing_token = subprocess.run(
            [
                "bash",
                str(ROOT / "scripts/release/finish-pypi.sh"),
                "anumat-py",
                "0.1.2",
                "anumat-py@0.1.2",
                str(wheel),
                str(sdist),
            ],
            cwd=repo,
            env=env,
            input="0.1.2\n",
            text=True,
            capture_output=True,
            check=False,
        )
        assert missing_token.returncode != 0
        assert "PYPI_TOKEN" in missing_token.stderr
        assert not log.exists()

        env["PYPI_TOKEN"] = "test-token"
        published = subprocess.run(
            [
                "bash",
                str(ROOT / "scripts/release/finish-pypi.sh"),
                "anumat-py",
                "0.1.2",
                "anumat-py@0.1.2",
                str(wheel),
                str(sdist),
            ],
            cwd=repo,
            env=env,
            input="0.1.2\n",
            text=True,
            capture_output=True,
            check=False,
        )
        assert published.returncode == 0, published.stderr
        assert log.read_text().strip() == f"publish {sdist}"
    finally:
        registry.stop()
