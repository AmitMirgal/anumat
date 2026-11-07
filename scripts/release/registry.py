#!/usr/bin/env python3
"""Fail-closed npm/PyPI lookups and hash plans for Anumat release scripts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, NoReturn

USER_AGENT = "anumat-release-scripts"
TIMEOUT_SECONDS = 30

ExitOk = 0
ExitMismatch = 1
ExitUnavailable = 2


class RegistryError(Exception):
    """A registry lookup failed closed."""


def fail(message: str, code: int) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def pypi_index() -> str:
    return os.environ.get("ANUMAT_PYPI_INDEX", "https://pypi.org/pypi").rstrip("/")


def npm_registry() -> str:
    return os.environ.get("ANUMAT_NPM_REGISTRY", "https://registry.npmjs.org").rstrip("/")


def fetch(url: str) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return int(response.status), response.read()
    except urllib.error.HTTPError as error:
        return int(error.code), error.read() if error.fp is not None else b""
    except urllib.error.URLError as error:
        reason = getattr(error, "reason", error)
        raise RegistryError(f"network error contacting {url}: {reason}") from error
    except TimeoutError as error:
        raise RegistryError(f"timed out contacting {url}") from error


def fetch_json(url: str) -> tuple[int, Any | None]:
    status, body = fetch(url)
    if status == 404:
        return status, None
    if status in {401, 403}:
        raise RegistryError(f"registry refused authentication for {url} (HTTP {status})")
    if status == 429:
        raise RegistryError(f"registry rate-limited {url} (HTTP 429)")
    if status >= 500:
        raise RegistryError(f"registry error for {url} (HTTP {status})")
    if status != 200:
        raise RegistryError(f"unexpected registry status for {url} (HTTP {status})")
    try:
        return status, json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RegistryError(f"registry returned non-JSON for {url}") from error


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def pypi_version_url(name: str, version: str) -> str:
    return f"{pypi_index()}/{urllib.parse.quote(name)}/{urllib.parse.quote(version)}/json"


def npm_version_url(name: str, version: str) -> str:
    encoded = urllib.parse.quote(name, safe="@")
    # Scoped names must encode the slash: @anumat/engine -> @anumat%2fengine
    encoded = encoded.replace("/", "%2f")
    return f"{npm_registry()}/{encoded}/{urllib.parse.quote(version)}"


def remote_pypi_files(payload: dict[str, Any]) -> dict[str, str]:
    files: dict[str, str] = {}
    urls = payload.get("urls")
    if urls is None:
        return files
    if not isinstance(urls, list):
        raise RegistryError("PyPI JSON urls is not a list")
    for item in urls:
        if not isinstance(item, dict):
            raise RegistryError("PyPI JSON url entry is not an object")
        filename = item.get("filename")
        digests = item.get("digests")
        if not isinstance(filename, str) or filename == "":
            raise RegistryError("PyPI file is missing a filename")
        if not isinstance(digests, dict) or not isinstance(digests.get("sha256"), str):
            raise RegistryError(f"PyPI file {filename} is missing digests.sha256")
        sha256 = digests["sha256"].lower()
        existing = files.get(filename)
        if existing is not None and existing != sha256:
            raise RegistryError(f"PyPI lists {filename} with more than one sha256")
        files[filename] = sha256
    return files


def pypi_status(name: str, version: str) -> str:
    status, payload = fetch_json(pypi_version_url(name, version))
    if status == 404:
        return "absent"
    if not isinstance(payload, dict):
        raise RegistryError("PyPI JSON body is not an object")
    return "present"


def npm_status(name: str, version: str) -> str:
    status, payload = fetch_json(npm_version_url(name, version))
    if status == 404:
        return "absent"
    if not isinstance(payload, dict):
        raise RegistryError("npm JSON body is not an object")
    return "present"


def npm_dist(name: str, version: str) -> dict[str, str]:
    status, payload = fetch_json(npm_version_url(name, version))
    if status == 404:
        raise RegistryError(f"{name} {version} is not on npm")
    if not isinstance(payload, dict):
        raise RegistryError("npm JSON body is not an object")
    dist = payload.get("dist")
    if not isinstance(dist, dict):
        raise RegistryError(f"npm JSON for {name} {version} has no dist")
    integrity = dist.get("integrity")
    shasum = dist.get("shasum")
    result: dict[str, str] = {}
    if isinstance(integrity, str) and integrity != "":
        result["integrity"] = integrity
    if isinstance(shasum, str) and shasum != "":
        result["shasum"] = shasum
    if not result:
        raise RegistryError(f"npm JSON for {name} {version} has no dist.integrity or dist.shasum")
    return result


def compare_npm(name: str, version: str, integrity: str, shasum: str) -> None:
    remote = npm_dist(name, version)
    if "integrity" in remote:
        if integrity == "":
            raise RegistryError("local pack JSON is missing integrity")
        if integrity != remote["integrity"]:
            fail(
                f"{name} {version} on npm has integrity {remote['integrity']}, local pack is {integrity}",
                ExitMismatch,
            )
        return
    if shasum == "":
        raise RegistryError("local pack JSON is missing shasum")
    if shasum != remote["shasum"]:
        fail(
            f"{name} {version} on npm has shasum {remote['shasum']}, local pack is {shasum}",
            ExitMismatch,
        )


def pypi_plan(name: str, version: str, files: list[Path]) -> dict[str, Any]:
    if not files:
        raise RegistryError("pypi-plan requires at least one local file")
    resolved: list[Path] = []
    local: dict[str, str] = {}
    for path in files:
        if not path.is_file():
            raise RegistryError(f"local artifact is missing: {path}")
        filename = path.name
        if filename in local:
            raise RegistryError(f"duplicate local filename {filename}")
        local[filename] = sha256_file(path)
        resolved.append(path)

    status, payload = fetch_json(pypi_version_url(name, version))
    if status == 404:
        return {
            "package": name,
            "version": version,
            "state": "new",
            "matched": [],
            "to_upload": [str(path) for path in resolved],
            "remote_files": [],
        }
    if not isinstance(payload, dict):
        raise RegistryError("PyPI JSON body is not an object")
    remote = remote_pypi_files(payload)
    matched: list[str] = []
    to_upload: list[str] = []
    for path in resolved:
        filename = path.name
        remote_hash = remote.get(filename)
        if remote_hash is None:
            to_upload.append(str(path))
            continue
        if remote_hash != local[filename]:
            fail(
                f"PyPI file {filename} sha256 {remote_hash} does not match local {local[filename]}. "
                "Refusing to skip or overwrite. Do not bump the version to hide this.",
                ExitMismatch,
            )
        matched.append(str(path))
    extra = sorted(set(remote) - set(local))
    if extra:
        fail(
            "PyPI has files that are not in the local artifact set: " + ", ".join(extra),
            ExitMismatch,
        )
    state = "complete" if not to_upload else "partial" if matched else "new"
    return {
        "package": name,
        "version": version,
        "state": state,
        "matched": matched,
        "to_upload": to_upload,
        "remote_files": sorted(remote),
    }


def cmd_pypi_status(args: argparse.Namespace) -> int:
    print(pypi_status(args.name, args.version))
    return ExitOk


def cmd_npm_status(args: argparse.Namespace) -> int:
    print(npm_status(args.name, args.version))
    return ExitOk


def cmd_npm_dist(args: argparse.Namespace) -> int:
    print(json.dumps(npm_dist(args.name, args.version), indent=2, sort_keys=True))
    return ExitOk


def cmd_compare_npm(args: argparse.Namespace) -> int:
    compare_npm(args.name, args.version, args.integrity, args.shasum)
    print("match")
    return ExitOk


def cmd_pypi_plan(args: argparse.Namespace) -> int:
    plan = pypi_plan(args.name, args.version, [Path(path) for path in args.files])
    json.dump(plan, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return ExitOk


def cmd_sha256(args: argparse.Namespace) -> int:
    print(sha256_file(Path(args.file)))
    return ExitOk


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    pypi_status_p = sub.add_parser("pypi-status", help="print present or absent")
    pypi_status_p.add_argument("--name", required=True)
    pypi_status_p.add_argument("--version", required=True)
    pypi_status_p.set_defaults(func=cmd_pypi_status)

    plan = sub.add_parser("pypi-plan", help="compare local files to PyPI hashes")
    plan.add_argument("--name", required=True)
    plan.add_argument("--version", required=True)
    plan.add_argument("files", nargs="+")
    plan.set_defaults(func=cmd_pypi_plan)

    npm_status_p = sub.add_parser("npm-status", help="print present or absent")
    npm_status_p.add_argument("--name", required=True)
    npm_status_p.add_argument("--version", required=True)
    npm_status_p.set_defaults(func=cmd_npm_status)

    npm_dist_p = sub.add_parser("npm-dist", help="print dist integrity metadata")
    npm_dist_p.add_argument("--name", required=True)
    npm_dist_p.add_argument("--version", required=True)
    npm_dist_p.set_defaults(func=cmd_npm_dist)

    compare = sub.add_parser("compare-npm", help="compare a local pack to npm")
    compare.add_argument("--name", required=True)
    compare.add_argument("--version", required=True)
    compare.add_argument("--integrity", default="")
    compare.add_argument("--shasum", default="")
    compare.set_defaults(func=cmd_compare_npm)

    sha = sub.add_parser("sha256", help="print a file sha256")
    sha.add_argument("file")
    sha.set_defaults(func=cmd_sha256)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except RegistryError as error:
        fail(str(error), ExitUnavailable)


if __name__ == "__main__":
    raise SystemExit(main())
