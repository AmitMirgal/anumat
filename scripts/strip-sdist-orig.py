"""Remove pyproject.toml.orig from sdists in a directory.

uv 0.13 writes that copy after it applies source-exclude, so
tool.uv.build-backend.source-exclude cannot drop it.
"""

from __future__ import annotations

import sys
import tarfile
from pathlib import Path


def strip(directory: Path) -> None:
    for path in sorted(directory.glob("*.tar.gz")):
        temporary = path.with_name(path.name + ".tmp")
        with tarfile.open(path, "r:gz") as source, tarfile.open(temporary, "w:gz") as target:
            for member in source.getmembers():
                if Path(member.name).name == "pyproject.toml.orig":
                    continue
                payload = source.extractfile(member) if member.isfile() else None
                target.addfile(member, payload)
        temporary.replace(path)


if __name__ == "__main__":
    strip(Path(sys.argv[1]))
