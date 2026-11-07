from __future__ import annotations

import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_sdist_excludes_pyproject_toml_orig(tmp_path: Path) -> None:
    project = (ROOT / "packages" / "sdk-python" / "pyproject.toml").read_text()
    assert 'source-exclude = ["pyproject.toml.orig"]' in project
    release = (ROOT / "scripts" / "release.sh").read_text()
    generated = release.find("_generated/client.py")
    build = release.find("uv build --package anumat-py")
    strip = release.find("scripts/strip-sdist-orig.py")
    publish = release.find("finish-pypi.sh")
    assert generated != -1
    assert build != -1
    assert strip != -1
    assert publish != -1
    assert generated < build < strip < publish

    subprocess.run(
        ["uv", "build", "--sdist", "--package", "anumat-py", "--out-dir", str(tmp_path)],
        cwd=ROOT,
        check=True,
    )
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "strip-sdist-orig.py"), str(tmp_path)],
        check=True,
    )
    archives = list(tmp_path.glob("anumat_py-*.tar.gz"))
    assert len(archives) == 1
    with tarfile.open(archives[0]) as archive:
        names = archive.getnames()
    assert any(name.endswith("pyproject.toml") for name in names)
    assert not any(name.endswith("pyproject.toml.orig") for name in names)
