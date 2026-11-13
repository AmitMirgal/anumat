from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MAKE_VENV = ROOT / "scripts" / "release" / "make-smoke-venv.sh"
WRAPPER = ROOT / "scripts" / "engine-py-make-smoke-venv.sh"
RELEASE = ROOT / "scripts" / "release-engine-py.sh"
CI_SMOKE = ROOT / "packages" / "engine-py" / "scripts" / "ci-smoke.sh"
CI_CONVERT = ROOT / "packages" / "engine-py" / "scripts" / "ci-convert-smoke.sh"
ANUMAT_PY = ROOT / "scripts" / "release.sh"


def _make_venv(tmp_path: Path, prefix: str = "anumat-engine-smoke") -> tuple[Path, Path]:
    env = os.environ.copy()
    env["TMPDIR"] = str(tmp_path)
    result = subprocess.run(
        ["bash", str(MAKE_VENV), prefix],
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


def test_wrapper_still_creates_an_owned_venv(tmp_path: Path) -> None:
    env = os.environ.copy()
    env["TMPDIR"] = str(tmp_path)
    leftover = tmp_path / "anumat-engine-smoke"
    leftover.mkdir()
    (leftover / "keep-me").write_text("user-files")
    result = subprocess.run(
        ["bash", str(WRAPPER)],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    work = Path(result.stdout.splitlines()[0])
    try:
        assert leftover.joinpath("keep-me").read_text() == "user-files"
        assert work.parent.resolve() == tmp_path.resolve()
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _no_force_clear(path: Path) -> None:
    for line in path.read_text().splitlines():
        code = line.split("#", 1)[0]
        assert "--force" not in code, path
        assert "--clear" not in code, path


def test_release_and_ci_smoke_use_owned_venv_and_native_wheel() -> None:
    script = RELEASE.read_text()
    ci = CI_SMOKE.read_text()
    py = ANUMAT_PY.read_text()
    helper = MAKE_VENV.read_text()
    assert "bash scripts/release/make-smoke-venv.sh" in script
    convert = CI_CONVERT.read_text()
    assert "bash scripts/release/make-smoke-venv.sh" in ci
    assert "bash scripts/release/make-smoke-venv.sh anumat-py-smoke" in py
    assert "select_native_wheel.py" in script
    assert "select_native_wheel.py" in ci
    assert "select_native_wheel.py" in convert
    assert "convert_smoke.py" in convert
    assert "docker" not in convert
    _no_force_clear(CI_CONVERT)
    assert "uv venv /tmp/anumat-engine-smoke --clear" not in script
    assert "uv venv /tmp/anumat-engine-smoke --clear" not in ci
    assert "/tmp/anutest" not in py
    assert "docker rm -f" not in ci
    _no_force_clear(MAKE_VENV)
    _no_force_clear(CI_SMOKE)
    _no_force_clear(RELEASE)
    assert 'uv venv "$work/venv" -q' in helper
    assert script.index("bash scripts/release/make-smoke-venv.sh") < script.index(
        'uv pip install -q --python "$smoke_python" "$wheel"'
    )
    assert script.index('"$smoke_python" packages/engine-py/scripts/smoke.py') < script.index(
        "bash scripts/release/finish-pypi.sh"
    )
    assert ci.index("select_native_wheel.py") < ci.index("make-smoke-venv.sh")
