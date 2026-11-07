from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path

from release_fakes import write_executable

ROOT = Path(__file__).resolve().parents[3]
PLATFORMS = json.loads((ROOT / "packages/engine-py/platforms.json").read_text())
MIGRATION = ROOT / "packages/db/prisma/migrations/20260929061425_init/migration.sql"
VERSION = next(
    line.split("=", 1)[1].strip().strip('"')
    for line in (ROOT / "packages/engine-py/pyproject.toml").read_text().splitlines()
    if line.startswith("version =")
)


def _migration_sha() -> str:
    return hashlib.sha256(MIGRATION.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def _artifact_tree(tmp_path: Path, *, version: str = VERSION) -> Path:
    artifacts = tmp_path / "artifacts"
    sha = _migration_sha()
    for item in PLATFORMS:
        platform = item["platform"]
        wheel_dir = artifacts / f"anumat-engine-{platform}"
        wheel_dir.mkdir(parents=True)
        (wheel_dir / f"anumat_engine-{version}-py3-none-{platform}.whl").write_bytes(f"wheel-{platform}".encode())
        checksum_dir = artifacts / f"anumat-engine-migration-sha-{platform}"
        checksum_dir.mkdir(parents=True)
        (checksum_dir / "migration.sha256").write_text(f"{sha}\n")
    sdist = artifacts / "anumat-engine-sdist"
    sdist.mkdir()
    (sdist / f"anumat_engine-{version}.tar.gz").write_bytes(b"sdist")
    return artifacts


def _assemble(artifacts: Path, out: Path, commit: str) -> None:
    result = subprocess.run(
        [
            "python3",
            str(ROOT / "scripts/release/assemble_engine_bundle.py"),
            "--repo",
            str(ROOT),
            "--artifacts-dir",
            str(artifacts),
            "--out",
            str(out),
            "--commit",
            commit,
            "--version",
            VERSION,
            "--run-id",
            "55",
            "--run-url",
            "https://example.test/55",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_assemble_and_verify_bundle(tmp_path: Path) -> None:
    artifacts = _artifact_tree(tmp_path)
    out = tmp_path / "bundle"
    _assemble(artifacts, out, "abc123")
    verified = subprocess.run(
        [
            "python3",
            str(ROOT / "scripts/release/verify_engine_bundle.py"),
            "--repo",
            str(ROOT),
            "--bundle",
            str(out),
            "--commit",
            "abc123",
            "--version",
            VERSION,
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert verified.returncode == 0, verified.stderr
    wrong_commit = subprocess.run(
        [
            "python3",
            str(ROOT / "scripts/release/verify_engine_bundle.py"),
            "--repo",
            str(ROOT),
            "--bundle",
            str(out),
            "--commit",
            "fff",
            "--version",
            VERSION,
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert wrong_commit.returncode != 0
    assert "does not match HEAD" in wrong_commit.stderr


def test_assemble_rejects_missing_platform(tmp_path: Path) -> None:
    artifacts = _artifact_tree(tmp_path)
    missing = next(artifacts.glob("anumat-engine-macosx_11_0_arm64/*.whl"))
    missing.unlink()
    result = subprocess.run(
        [
            "python3",
            str(ROOT / "scripts/release/assemble_engine_bundle.py"),
            "--repo",
            str(ROOT),
            "--artifacts-dir",
            str(artifacts),
            "--out",
            str(tmp_path / "bundle"),
            "--commit",
            "abc123",
            "--version",
            VERSION,
            "--run-id",
            "1",
            "--run-url",
            "https://example.test/1",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert "missing" in result.stderr


def test_verify_rejects_wrong_checksum(tmp_path: Path) -> None:
    artifacts = _artifact_tree(tmp_path)
    out = tmp_path / "bundle"
    _assemble(artifacts, out, "abc123")
    wheel = next(out.glob("*.whl"))
    wheel.write_bytes(b"tampered")
    result = subprocess.run(
        [
            "python3",
            str(ROOT / "scripts/release/verify_engine_bundle.py"),
            "--repo",
            str(ROOT),
            "--bundle",
            str(out),
            "--commit",
            "abc123",
            "--version",
            VERSION,
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode != 0
    assert "does not match SHA256SUMS" in result.stderr


def test_fetch_success_in_progress_failed_expired_and_missing_cli(tmp_path: Path) -> None:
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    artifacts = _artifact_tree(tmp_path)
    bundle = tmp_path / "built"
    _assemble(artifacts, bundle, head)

    def run_fetch(mode: str) -> subprocess.CompletedProcess[str]:
        gh = tmp_path / f"gh-{mode}"
        gh.mkdir()
        log = tmp_path / f"{mode}.log"
        runs = tmp_path / f"{mode}.json"
        if mode == "success":
            runs.write_text(
                json.dumps(
                    [
                        {
                            "databaseId": 55,
                            "conclusion": "success",
                            "status": "completed",
                            "headSha": head,
                            "url": "https://example.test/55",
                            "event": "push",
                        }
                    ]
                )
            )
            download = f"""
    if [[ "$2" == download ]]; then
      dir=""
      name=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --dir) dir="$2"; shift 2 ;;
          --name) name="$2"; shift 2 ;;
          *) shift ;;
        esac
      done
      [[ "$name" == anumat-engine-release ]]
      cp -a '{bundle}/.' "$dir"/
      exit 0
    fi
"""
        elif mode == "expired":
            runs.write_text(
                json.dumps(
                    [
                        {
                            "databaseId": 7,
                            "conclusion": "success",
                            "status": "completed",
                            "headSha": head,
                            "url": "https://example.test/7",
                            "event": "push",
                        }
                    ]
                )
            )
            download = """
    if [[ "$2" == download ]]; then echo "artifact expired (410 Gone)" >&2; exit 1; fi
"""
        elif mode == "in_progress":
            runs.write_text(
                json.dumps(
                    [
                        {
                            "databaseId": 3,
                            "conclusion": None,
                            "status": "in_progress",
                            "headSha": head,
                            "url": "https://example.test/3",
                            "event": "push",
                        }
                    ]
                )
            )
            download = """
    if [[ "$2" == download ]]; then echo should-not-download >&2; exit 1; fi
"""
        elif mode == "failed":
            runs.write_text(
                json.dumps(
                    [
                        {
                            "databaseId": 4,
                            "conclusion": "failure",
                            "status": "completed",
                            "headSha": head,
                            "url": "https://example.test/4",
                            "event": "push",
                        }
                    ]
                )
            )
            download = """
    if [[ "$2" == download ]]; then echo should-not-download >&2; exit 1; fi
"""
        else:
            raise AssertionError(mode)
        write_executable(
            gh / "gh",
            f"""#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> '{log}'
if [[ "$1" == auth ]]; then exit 0; fi
if [[ "$1" == run && "$2" == list ]]; then cat '{runs}'; exit 0; fi
if [[ "$1" == run ]]; then
{download}
fi
echo "unexpected gh $*" >&2
exit 99
""",
        )
        out = tmp_path / f"out-{mode}"
        env = os.environ.copy()
        env["ANUMAT_GH"] = str(gh / "gh")
        env["PATH"] = f"{gh}{os.pathsep}{env.get('PATH', '')}"
        return subprocess.run(
            ["bash", str(ROOT / "scripts/release/fetch-engine-ci-bundle.sh"), str(out)],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

    success = run_fetch("success")
    assert success.returncode == 0, success.stderr
    assert (tmp_path / "out-success" / "provenance.json").is_file()

    expired = run_fetch("expired")
    assert expired.returncode != 0
    assert "expired" in expired.stderr
    assert "will not compile" in expired.stderr

    pending = run_fetch("in_progress")
    assert pending.returncode != 0
    assert "still running" in pending.stderr

    failed = run_fetch("failed")
    assert failed.returncode != 0
    assert "did not succeed" in failed.stderr

    env = os.environ.copy()
    env["ANUMAT_GH"] = str(tmp_path / "missing-gh")
    missing = subprocess.run(
        ["bash", str(ROOT / "scripts/release/fetch-engine-ci-bundle.sh"), str(tmp_path / "out-missing")],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert missing.returncode != 0
    assert "gh is not on PATH" in missing.stderr
    assert "will not compile" in missing.stderr
