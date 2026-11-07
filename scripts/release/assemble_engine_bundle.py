#!/usr/bin/env python3
"""Assemble the anumat-engine release bundle from CI artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

SCHEMA = "anumat-engine-release-bundle/v1"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def load_platforms(repo: Path) -> list[str]:
    payload = json.loads((repo / "packages/engine-py/platforms.json").read_text())
    platforms: list[str] = []
    for item in payload:
        if not isinstance(item, dict) or not isinstance(item.get("platform"), str):
            raise SystemExit("platforms.json is malformed")
        platforms.append(item["platform"])
    if len(platforms) != 5:
        raise SystemExit(f"expected 5 platforms, found {len(platforms)}")
    return platforms


def find_files(root: Path, suffix: str) -> list[Path]:
    return sorted(path for path in root.rglob("*") if path.is_file() and path.name.endswith(suffix))


def assemble(args: argparse.Namespace) -> int:
    repo = Path(args.repo).resolve()
    artifacts = Path(args.artifacts_dir).resolve()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    platforms = load_platforms(repo)
    wheels = find_files(artifacts, ".whl")
    sdists = [path for path in find_files(artifacts, ".tar.gz") if path.name.endswith(".tar.gz")]
    checksums = [path for path in find_files(artifacts, "migration.sha256") if path.name == "migration.sha256"]
    version = args.version
    expected_wheels = {f"anumat_engine-{version}-py3-none-{platform}.whl": platform for platform in platforms}
    expected_sdist = f"anumat_engine-{version}.tar.gz"

    found_wheels = {path.name: path for path in wheels}
    extra_wheels = sorted(set(found_wheels) - set(expected_wheels))
    missing_wheels = sorted(set(expected_wheels) - set(found_wheels))
    if extra_wheels or missing_wheels:
        raise SystemExit(
            "wheel set does not match platforms.json: "
            f"missing={missing_wheels or 'none'} extra={extra_wheels or 'none'}"
        )
    if len(sdists) != 1:
        names = ", ".join(path.name for path in sdists) or "none"
        raise SystemExit(f"expected one sdist named {expected_sdist}, found {names}")
    if sdists[0].name != expected_sdist:
        raise SystemExit(f"sdist is {sdists[0].name}, expected {expected_sdist}")
    if len(checksums) != 5:
        raise SystemExit(f"expected 5 migration checksums, found {len(checksums)}")
    unique = {path.read_text().strip() for path in checksums}
    if len(unique) != 1 or "" in unique:
        raise SystemExit("migration checksums differ or are empty")
    migration_sha = unique.pop()

    publishable = [*[found_wheels[name] for name in sorted(expected_wheels)], sdists[0]]
    for path in publishable:
        shutil.copy2(path, out / path.name)
    (out / "migration.sha256").write_text(f"{migration_sha}\n")
    sums = []
    for name in [*(sorted(expected_wheels)), expected_sdist]:
        digest = sha256_file(out / name)
        sums.append(f"{digest}  {name}")
    (out / "SHA256SUMS").write_text("\n".join(sums) + "\n")
    provenance = {
        "schema": SCHEMA,
        "commit": args.commit,
        "version": version,
        "run_id": args.run_id,
        "run_url": args.run_url,
        "workflow": "Engine wheels",
        "files": [*(sorted(expected_wheels)), expected_sdist],
        "migration_sha256": migration_sha,
    }
    (out / "provenance.json").write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")
    print(f"assembled {len(publishable)} publishable files for {version}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--artifacts-dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-url", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return assemble(args)


if __name__ == "__main__":
    raise SystemExit(main())
