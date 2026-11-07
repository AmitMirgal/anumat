#!/usr/bin/env python3
"""Verify an anumat-engine CI release bundle before publish."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

SCHEMA = "anumat-engine-release-bundle/v1"
MIGRATION = "packages/db/prisma/migrations/20260929061425_init/migration.sql"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def migration_sha(repo: Path) -> str:
    raw = (repo / MIGRATION).read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(raw).hexdigest()


def load_platforms(repo: Path) -> list[str]:
    payload = json.loads((repo / "packages/engine-py/platforms.json").read_text())
    return [item["platform"] for item in payload]


def verify(args: argparse.Namespace) -> int:
    repo = Path(args.repo).resolve()
    bundle = Path(args.bundle).resolve()
    provenance_path = bundle / "provenance.json"
    sums_path = bundle / "SHA256SUMS"
    migration_path = bundle / "migration.sha256"
    for path in (provenance_path, sums_path, migration_path):
        if not path.is_file():
            raise SystemExit(f"release bundle is missing {path.name}")
    provenance = json.loads(provenance_path.read_text())
    if provenance.get("schema") != SCHEMA:
        raise SystemExit(f"unsupported bundle schema {provenance.get('schema')!r}")
    if provenance.get("commit") != args.commit:
        raise SystemExit(
            f"bundle commit {provenance.get('commit')} does not match HEAD {args.commit}"
        )
    if provenance.get("version") != args.version:
        raise SystemExit(
            f"bundle version {provenance.get('version')} does not match {args.version}"
        )
    if provenance.get("workflow") != "Engine wheels":
        raise SystemExit("bundle is not from the Engine wheels workflow")
    files = provenance.get("files")
    if not isinstance(files, list) or not all(isinstance(name, str) for name in files):
        raise SystemExit("provenance files list is malformed")
    platforms = load_platforms(repo)
    expected = [f"anumat_engine-{args.version}-py3-none-{platform}.whl" for platform in platforms]
    expected.append(f"anumat_engine-{args.version}.tar.gz")
    if sorted(files) != sorted(expected):
        raise SystemExit(f"provenance files do not match this commit's platforms/version: {files}")
    listed: dict[str, str] = {}
    for line in sums_path.read_text().splitlines():
        if line.strip() == "":
            continue
        try:
            digest, name = line.split("  ", 1)
        except ValueError as error:
            raise SystemExit(f"SHA256SUMS is malformed: {line!r}") from error
        listed[name] = digest.lower()
    if sorted(listed) != sorted(expected):
        raise SystemExit("SHA256SUMS does not list exactly the publishable files")
    for name in expected:
        path = bundle / name
        if not path.is_file():
            raise SystemExit(f"bundle is missing {name}")
        actual = sha256_file(path)
        if actual != listed[name]:
            raise SystemExit(f"{name} sha256 {actual} does not match SHA256SUMS {listed[name]}")
    extras = [
        path.name
        for path in bundle.iterdir()
        if path.is_file()
        and path.suffix in {".whl", ".gz"}
        and path.name not in expected
        and path.name != "migration.sha256"
    ]
    if extras:
        raise SystemExit("bundle has unexpected publishable files: " + ", ".join(sorted(extras)))
    bundle_migration = migration_path.read_text().strip()
    if bundle_migration != provenance.get("migration_sha256"):
        raise SystemExit("provenance migration sha256 does not match migration.sha256")
    repo_migration = migration_sha(repo)
    if bundle_migration != repo_migration:
        raise SystemExit(
            f"bundle migration sha256 {bundle_migration} does not match repo {MIGRATION} ({repo_migration})"
        )
    print(f"bundle ok commit={args.commit} version={args.version} files={len(expected)}")
    print(f"run {provenance.get('run_url', provenance.get('run_id'))}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--version", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    return verify(build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
