#!/usr/bin/env python3
"""Pick the host-matching anumat-engine wheel. Multiple wheels are not an error if one matches."""

from __future__ import annotations

import platform
import sys
from pathlib import Path


def native_tag() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "darwin" and machine in {"arm64", "aarch64"}:
        return "macosx_11_0_arm64"
    if system == "darwin" and machine in {"x86_64", "amd64"}:
        return "macosx_11_0_x86_64"
    if system == "linux" and machine in {"x86_64", "amd64"}:
        return "manylinux_2_17_x86_64"
    if system == "linux" and machine in {"aarch64", "arm64"}:
        return "manylinux_2_17_aarch64"
    if system == "windows" and machine in {"x86_64", "amd64"}:
        return "win_amd64"
    raise SystemExit(f"no anumat-engine wheel tag for {system} {machine}")


def select(dist: Path) -> Path:
    if not dist.is_dir():
        raise SystemExit(f"wheel directory does not exist: {dist}")
    wheels = sorted(path for path in dist.iterdir() if path.is_file() and path.suffix == ".whl")
    if not wheels:
        raise SystemExit(f"no wheels in {dist}")
    tag = native_tag()
    suffix = f"-py3-none-{tag}.whl"
    matches = [path for path in wheels if path.name.endswith(suffix)]
    names = ", ".join(path.name for path in wheels)
    if not matches:
        raise SystemExit(f"no wheel for {tag} in {dist} (found: {names})")
    if len(matches) > 1:
        found = ", ".join(path.name for path in matches)
        raise SystemExit(f"multiple wheels for {tag}: {found}")
    return matches[0]


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("Use: select_native_wheel.py DIST_DIR", file=sys.stderr)
        return 1
    print(select(Path(args[0])))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
