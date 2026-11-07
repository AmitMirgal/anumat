from __future__ import annotations

import importlib.util
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _load_select():
    spec = importlib.util.spec_from_file_location(
        "select_native_wheel",
        ROOT / "scripts/release/select_native_wheel.py",
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_select_native_wheel_among_many(tmp_path: Path) -> None:
    module = _load_select()
    tag = module.native_tag()
    dist = tmp_path / "dist"
    dist.mkdir()
    for other in ("macosx_11_0_arm64", "macosx_11_0_x86_64", "manylinux_2_17_x86_64", "manylinux_2_17_aarch64", "win_amd64"):
        (dist / f"anumat_engine-0.1.2-py3-none-{other}.whl").write_bytes(b"w")
    selected = module.select(dist)
    assert selected.name.endswith(f"-py3-none-{tag}.whl")
    empty = tmp_path / "empty"
    empty.mkdir()
    result = subprocess.run(
        ["python3", str(ROOT / "scripts/release/select_native_wheel.py"), str(empty)],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert "no wheels" in result.stderr
    duplicate = tmp_path / "dup"
    duplicate.mkdir()
    (duplicate / f"anumat_engine-0.1.2-py3-none-{tag}.whl").write_bytes(b"a")
    (duplicate / f"anumat_engine-0.1.3-py3-none-{tag}.whl").write_bytes(b"b")
    result = subprocess.run(
        ["python3", str(ROOT / "scripts/release/select_native_wheel.py"), str(duplicate)],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert "multiple wheels" in result.stderr


def test_tag_local_creates_rejects_move_and_never_pushes(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "release@example.test"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Release Test"], cwd=repo, check=True)
    (repo / "a").write_text("a\n")
    subprocess.run(["git", "add", "a"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "one"], cwd=repo, check=True)
    first = subprocess.run(
        ["bash", str(ROOT / "scripts/release/tag-local.sh"), "anumat-py@0.1.2"],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )
    assert first.returncode == 0, first.stderr
    assert "Created local tag" in first.stdout
    assert "does not push" in first.stdout
    again = subprocess.run(
        ["bash", str(ROOT / "scripts/release/tag-local.sh"), "anumat-py@0.1.2"],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )
    assert again.returncode == 0, again.stderr
    assert "already points at HEAD" in again.stdout
    (repo / "b").write_text("b\n")
    subprocess.run(["git", "add", "b"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "two"], cwd=repo, check=True)
    moved = subprocess.run(
        ["bash", str(ROOT / "scripts/release/tag-local.sh"), "anumat-py@0.1.2"],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )
    assert moved.returncode != 0
    assert "Refusing to move" in moved.stderr


def test_confirm_version_accepts_and_rejects() -> None:
    ok = subprocess.run(
        ["bash", str(ROOT / "scripts/release/confirm-version.sh"), "1.2.3", "publish", "Cancelled. Nothing was published."],
        cwd=ROOT,
        input="1.2.3\n",
        text=True,
        capture_output=True,
        check=False,
    )
    assert ok.returncode == 0, ok.stderr
    no = subprocess.run(
        ["bash", str(ROOT / "scripts/release/confirm-version.sh"), "1.2.3", "publish", "Cancelled. Nothing was published."],
        cwd=ROOT,
        input="nope\n",
        text=True,
        capture_output=True,
        check=False,
    )
    assert no.returncode == 1
    assert "Cancelled. Nothing was published." in no.stderr


def test_require_clean_main(tmp_path: Path) -> None:
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "release@example.test"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Release Test"], cwd=repo, check=True)
    (repo / "a").write_text("a\n")
    subprocess.run(["git", "add", "a"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "one"], cwd=repo, check=True)
    subprocess.run(["git", "remote", "add", "origin", str(remote)], cwd=repo, check=True)
    subprocess.run(["git", "push", "-q", "-u", "origin", "main"], cwd=repo, check=True)
    ok = subprocess.run(
        ["bash", str(ROOT / "scripts/release/require-clean-main.sh")],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )
    assert ok.returncode == 0, ok.stderr
    (repo / "a").write_text("dirty\n")
    dirty = subprocess.run(
        ["bash", str(ROOT / "scripts/release/require-clean-main.sh")],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )
    assert dirty.returncode != 0
    assert "Commit or stash" in dirty.stderr
    subprocess.run(["git", "checkout", "-q", "--", "a"], cwd=repo, check=True)
    subprocess.run(["git", "checkout", "-q", "-b", "other"], cwd=repo, check=True)
    branch = subprocess.run(
        ["bash", str(ROOT / "scripts/release/require-clean-main.sh")],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )
    assert branch.returncode != 0
    assert "Switch to main first" in branch.stderr
