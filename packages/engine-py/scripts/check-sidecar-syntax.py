"""Syntax-check the entry module embedded in a bun --compile sidecar.

`anumat-engine --help` is the startup check when this host can execute the
binary. macOS SIGKILLs an unsigned or invalidly signed bun compile (exit 137,
"Killed: 9"), and a wheel built for another platform cannot be executed
(exit 126 or 127). Neither of those is a JavaScript syntax error. This reads
the standalone module graph and runs `node --check` on the entry module, which
still fails the build on SyntaxError or Unexpected EOF.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

TRAILER = b"\n---- Bun! ----\n"
OFFSETS_SIZE = 32
USAGE = "Usage: anumat-engine"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(f"usage: {Path(sys.argv[0]).name} <sidecar-binary>")
    binary = Path(sys.argv[1])
    if not binary.is_file():
        raise SystemExit(f"sidecar binary does not exist: {binary}")
    source = entry_source(binary.read_bytes())
    node = shutil.which("node")
    if node is None:
        raise SystemExit("node is required to syntax-check the embedded sidecar")
    temporary = tempfile.NamedTemporaryFile(suffix=".js", delete=False)
    path = Path(temporary.name)
    try:
        temporary.write(source.encode("utf-8"))
        temporary.close()
        checked = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
    finally:
        path.unlink(missing_ok=True)
    if checked.returncode != 0:
        sys.stderr.write(checked.stdout)
        sys.stderr.write(checked.stderr)
        raise SystemExit(f"embedded sidecar JavaScript failed syntax check (exit {checked.returncode})")
    if USAGE not in source:
        raise SystemExit("embedded sidecar entry module is missing the usage string")
    print(f"embedded sidecar JavaScript parsed ({len(source)} bytes)")


def entry_source(data: bytes) -> str:
    positions: list[int] = []
    start = 0
    while True:
        found = data.find(TRAILER, start)
        if found < 0:
            break
        positions.append(found)
        start = found + 1
    if not positions:
        raise SystemExit("compiled sidecar has no bun module graph")
    errors: list[str] = []
    for trailer_start in reversed(positions):
        try:
            return entry_at(data, trailer_start)
        except ValueError as exc:
            errors.append(str(exc))
    detail = errors[0] if errors else "no trailer candidate"
    raise SystemExit(f"could not read the embedded sidecar entry module: {detail}")


def entry_at(data: bytes, trailer_start: int) -> str:
    offsets_start = trailer_start - OFFSETS_SIZE
    if offsets_start < 0:
        raise ValueError("trailer has no offsets record")
    byte_count = read_u64(data, offsets_start)
    if byte_count <= 0 or byte_count > offsets_start:
        raise ValueError("byte count is out of range")
    data_start = offsets_start - byte_count
    blob = data[data_start:offsets_start]
    modules_offset = read_u32(data, offsets_start + 8)
    modules_length = read_u32(data, offsets_start + 12)
    entry_point_id = read_u32(data, offsets_start + 16)
    module_bytes = slice_at(blob, modules_offset, modules_length, "module table")
    sizes = [size for size in (52, 36) if len(module_bytes) % size == 0]
    if not sizes:
        raise ValueError(f"module table length {len(module_bytes)} is not 36- or 52-byte records")
    errors: list[str] = []
    fallback: str | None = None
    for record_size in sizes:
        try:
            text = read_entry(blob, module_bytes, entry_point_id, record_size)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if USAGE in text:
            return text
        fallback = text
    if fallback is not None:
        return fallback
    detail = "; ".join(errors) if errors else "no record layout"
    raise ValueError(detail)


def read_entry(blob: bytes, module_bytes: bytes, entry_point_id: int, record_size: int) -> str:
    count = len(module_bytes) // record_size
    if entry_point_id >= count:
        raise ValueError(f"entry point {entry_point_id} is outside {count} modules")
    record = module_bytes[entry_point_id * record_size : (entry_point_id + 1) * record_size]
    contents_offset = read_u32(record, 8)
    contents_length = read_u32(record, 12)
    raw = slice_at(blob, contents_offset, contents_length, "entry module")
    if raw == b"":
        raise ValueError("entry module is empty")
    encoding = record[48 if record_size == 52 else 32]
    if encoding == 2:
        if len(raw) % 2 != 0:
            raise ValueError("utf-16 entry module has an odd length")
        return raw.decode("utf-16le")
    if encoding not in (0, 1):
        raise ValueError(f"entry module has unknown encoding {encoding}")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("entry module is not utf-8") from exc


def slice_at(blob: bytes, offset: int, length: int, label: str) -> bytes:
    end = offset + length
    if offset < 0 or length < 0 or end > len(blob):
        raise ValueError(f"{label} is outside the module graph")
    return blob[offset:end]


def read_u32(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 4 > len(data):
        raise ValueError("truncated u32")
    return int.from_bytes(data[offset : offset + 4], "little")


def read_u64(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 8 > len(data):
        raise ValueError("truncated u64")
    return int.from_bytes(data[offset : offset + 8], "little")


if __name__ == "__main__":
    main()
