from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from release_fakes import FakeRegistry, write_executable

ROOT = Path(__file__).resolve().parents[3]


def _git_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "release@example.test"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Release Test"], cwd=repo, check=True)
    (repo / "n").write_text("n\n")
    subprocess.run(["git", "add", "n"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "init"], cwd=repo, check=True)
    return repo


def _npm_package(tmp_path: Path) -> Path:
    package = tmp_path / "pkg"
    package.mkdir()
    (package / "package.json").write_text(
        json.dumps(
            {
                "name": "@anumat/js",
                "version": "1.0.2",
                "license": "MIT",
                "files": ["index.js"],
            }
        )
        + "\n"
    )
    (package / "index.js").write_text("module.exports = {}\n")
    return package


def _pack_meta(package: Path) -> dict[str, str]:
    result = subprocess.run(
        ["bash", str(ROOT / "scripts/release/npm-pack-meta.sh"), str(package)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_npm_pack_meta_is_safe_and_has_integrity(tmp_path: Path) -> None:
    meta = _pack_meta(_npm_package(tmp_path))
    assert meta["filename"].endswith(".tgz")
    assert meta.get("integrity") or meta.get("shasum")


def _path_env(bin_dir: Path, registry: FakeRegistry, pnpm_log: Path) -> dict[str, str]:
    bin_dir.mkdir(exist_ok=True)
    real_npm = shutil.which("npm")
    assert real_npm is not None
    write_executable(
        bin_dir / "npm",
        f"""#!/usr/bin/env bash
if [[ "$1" == whoami ]]; then echo tester; exit 0; fi
exec '{real_npm}' "$@"
""",
    )
    write_executable(
        bin_dir / "pnpm",
        f"""#!/usr/bin/env bash
printf '%s\\n' "$*" >> '{pnpm_log}'
if [[ " $* " == *" publish "* ]]; then exit 0; fi
echo "unexpected pnpm $*" >&2
exit 99
""",
    )
    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["ANUMAT_NPM_REGISTRY"] = registry.npm_registry()
    return env


def test_finish_npm_tag_only_when_pack_matches(tmp_path: Path) -> None:
    package = _npm_package(tmp_path)
    meta = _pack_meta(package)
    registry = FakeRegistry()
    registry.start()
    registry.set_npm(
        "@anumat/js",
        "1.0.2",
        200,
        {"dist": {"integrity": meta.get("integrity", ""), "shasum": meta.get("shasum", "")}},
    )
    pnpm_log = tmp_path / "pnpm.log"
    env = _path_env(tmp_path / "bin", registry, pnpm_log)
    repo = _git_repo(tmp_path)
    try:
        cancelled = subprocess.run(
            [
                "bash",
                str(ROOT / "scripts/release/finish-npm.sh"),
                "@anumat/js",
                "1.0.2",
                str(package),
                "@anumat/js@1.0.2",
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
        assert not pnpm_log.exists()

        tagged = subprocess.run(
            [
                "bash",
                str(ROOT / "scripts/release/finish-npm.sh"),
                "@anumat/js",
                "1.0.2",
                str(package),
                "@anumat/js@1.0.2",
            ],
            cwd=repo,
            env=env,
            input="1.0.2\n",
            text=True,
            capture_output=True,
            check=False,
        )
        assert tagged.returncode == 0, tagged.stderr
        assert not pnpm_log.exists()
        tags = subprocess.run(["git", "tag"], cwd=repo, capture_output=True, text=True, check=True).stdout
        assert "@anumat/js@1.0.2" in tags
    finally:
        registry.stop()


def test_finish_npm_mismatch_is_fatal_before_publish(tmp_path: Path) -> None:
    package = _npm_package(tmp_path)
    registry = FakeRegistry()
    registry.start()
    registry.set_npm("@anumat/js", "1.0.2", 200, {"dist": {"integrity": "sha512-nope", "shasum": "nope"}})
    pnpm_log = tmp_path / "pnpm.log"
    env = _path_env(tmp_path / "bin", registry, pnpm_log)
    repo = _git_repo(tmp_path)
    try:
        result = subprocess.run(
            [
                "bash",
                str(ROOT / "scripts/release/finish-npm.sh"),
                "@anumat/js",
                "1.0.2",
                str(package),
                "@anumat/js@1.0.2",
            ],
            cwd=repo,
            env=env,
            input="1.0.2\n",
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 1
        assert not pnpm_log.exists()
        assert subprocess.run(["git", "tag"], cwd=repo, capture_output=True, text=True, check=True).stdout == ""
    finally:
        registry.stop()


def test_finish_npm_publishes_only_after_confirm_when_absent(tmp_path: Path) -> None:
    package = _npm_package(tmp_path)
    registry = FakeRegistry()
    registry.start()
    pnpm_log = tmp_path / "pnpm.log"
    env = _path_env(tmp_path / "bin", registry, pnpm_log)
    repo = _git_repo(tmp_path)
    try:
        cancelled = subprocess.run(
            [
                "bash",
                str(ROOT / "scripts/release/finish-npm.sh"),
                "@anumat/js",
                "1.0.2",
                str(package),
                "@anumat/js@1.0.2",
            ],
            cwd=repo,
            env=env,
            input="nope\n",
            text=True,
            capture_output=True,
            check=False,
        )
        assert cancelled.returncode == 1
        assert not pnpm_log.exists()

        published = subprocess.run(
            [
                "bash",
                str(ROOT / "scripts/release/finish-npm.sh"),
                "@anumat/js",
                "1.0.2",
                str(package),
                "@anumat/js@1.0.2",
            ],
            cwd=repo,
            env=env,
            input="1.0.2\n",
            text=True,
            capture_output=True,
            check=False,
        )
        assert published.returncode == 0, published.stderr
        assert "publish --access public --no-git-checks" in pnpm_log.read_text()
        tags = subprocess.run(["git", "tag"], cwd=repo, capture_output=True, text=True, check=True).stdout
        assert "@anumat/js@1.0.2" in tags
    finally:
        registry.stop()
