from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MAKE_VENV = ROOT / "scripts" / "engine-py-make-smoke-venv.sh"
RELEASE = ROOT / "scripts" / "release-engine-py.sh"


def _make_venv(tmp_path: Path) -> tuple[Path, Path]:
    env = os.environ.copy()
    env["TMPDIR"] = str(tmp_path)
    result = subprocess.run(
        ["bash", str(MAKE_VENV)],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    lines = [line for line in result.stdout.splitlines() if line]
    assert len(lines) == 2, result.stdout
    work = Path(lines[0])
    python = Path(lines[1])
    return work, python


def test_uv_clear_refuses_a_non_venv_directory(tmp_path: Path) -> None:
    leftover = tmp_path / "anumat-engine-smoke"
    leftover.mkdir()
    (leftover / "keep-me").write_text("user-files")
    result = subprocess.run(
        ["uv", "venv", str(leftover), "--clear", "-q"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert "not a virtual environment" in result.stderr
    assert (leftover / "keep-me").read_text() == "user-files"


def test_make_smoke_venv_uses_subdirectory_and_runs_python(tmp_path: Path) -> None:
    leftover = tmp_path / "anumat-engine-smoke"
    leftover.mkdir()
    marker = leftover / "keep-me"
    marker.write_text("user-files")
    work, python = _make_venv(tmp_path)
    try:
        assert work != leftover
        assert work.parent.resolve() == tmp_path.resolve()
        assert python.as_posix().startswith(work.as_posix() + "/")
        assert python.name.startswith("python")
        ran = subprocess.run(
            [str(python), "-c", "import sys; print(sys.prefix)"],
            text=True,
            capture_output=True,
            check=True,
        )
        prefix = Path(ran.stdout.strip())
        assert prefix.as_posix().startswith((work / "venv").as_posix())
        assert marker.read_text() == "user-files"
    finally:
        shutil.rmtree(work, ignore_errors=True)
    assert not work.exists()
    assert marker.read_text() == "user-files"


def test_make_smoke_venv_python_can_install_a_local_wheel(tmp_path: Path) -> None:
    probe = tmp_path / "probe"
    (probe / "src" / "anumat_smoke_probe").mkdir(parents=True)
    (probe / "pyproject.toml").write_text(
        "[build-system]\nrequires = [\"hatchling\"]\nbuild-backend = \"hatchling.build\"\n\n"
        "[project]\nname = \"anumat-smoke-probe\"\nversion = \"0.0.0\"\n"
        "requires-python = \">=3.10\"\n"
    )
    (probe / "src" / "anumat_smoke_probe" / "__init__.py").write_text("marker = 'probe-ok'\n")
    built = subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(tmp_path / "dist")],
        cwd=probe,
        text=True,
        capture_output=True,
        check=False,
    )
    assert built.returncode == 0, built.stderr
    wheels = list((tmp_path / "dist").glob("anumat_smoke_probe-*.whl"))
    assert len(wheels) == 1
    work, python = _make_venv(tmp_path)
    try:
        installed = subprocess.run(
            ["uv", "pip", "install", "-q", "--python", str(python), str(wheels[0])],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        assert installed.returncode == 0, installed.stderr
        ran = subprocess.run(
            [str(python), "-c", "import anumat_smoke_probe as p; print(p.marker)"],
            text=True,
            capture_output=True,
            check=True,
        )
        assert ran.stdout.strip() == "probe-ok"
        failed = subprocess.run(
            [str(python), "-c", "raise SystemExit('smoke-failure')"],
            text=True,
            capture_output=True,
            check=False,
        )
        assert failed.returncode != 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


def test_release_script_smokes_native_wheel_from_owned_venv() -> None:
    script = RELEASE.read_text()
    helper = MAKE_VENV.read_text()
    assert "bash scripts/engine-py-make-smoke-venv.sh" in script
    assert 'uv pip install -q --python "$smoke_python" "$wheel"' in script
    assert '"$smoke_python" packages/engine-py/scripts/smoke.py' in script
    assert "uv venv /tmp/anumat-engine-smoke --clear" not in script
    for line in helper.splitlines():
        code = line.split("#", 1)[0]
        assert "--force" not in code
        assert "--clear" not in code
    assert 'uv venv "$work/venv" -q' in helper
    assert script.index("bash scripts/engine-py-make-smoke-venv.sh") < script.index(
        'uv pip install -q --python "$smoke_python" "$wheel"'
    )
    assert script.index('"$smoke_python" packages/engine-py/scripts/smoke.py') < script.index(
        "uv publish --token"
    )
    assert "set -euo pipefail" in script.splitlines()[1]
    for line in script.splitlines():
        if "git push" in line:
            assert line.lstrip().startswith("echo ")
        if "uv publish" in line:
            assert "PYPI_TOKEN" in line
