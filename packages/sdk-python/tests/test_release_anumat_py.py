from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_anumat_py_release_uses_owned_venv_and_hash_resume() -> None:
    release = (ROOT / "scripts" / "release.sh").read_text()
    assert "make-smoke-venv.sh anumat-py-smoke" in release
    assert "/tmp/anutest" not in release
    assert "--force" not in release
    assert "finish-pypi.sh" in release
    assert "strip-sdist-orig.py" in release
    assert release.index("_generated/client.py") < release.index("uv build --package anumat-py")
    assert release.index("uv build --package anumat-py") < release.index("strip-sdist-orig.py")
    assert release.index("strip-sdist-orig.py") < release.index("finish-pypi.sh")
    assert "require-local-postgres.sh" in release
    assert "ensure-smoke-database.mjs" in release
