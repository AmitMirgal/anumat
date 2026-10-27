"""Regenerate the typed client from apps/api/openapi.json."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "apps" / "api" / "openapi.json"
OUT = Path(__file__).resolve().parent / "src" / "anumat_py" / "_generated"


def main() -> None:
    if not SPEC.is_file():
        raise SystemExit(f"missing {SPEC}. Build @anumat/api first.")
    if OUT.exists():
        shutil.rmtree(OUT)
    subprocess.check_call(
        [
            sys.executable,
            "-m",
            "openapi_python_client",
            "generate",
            "--path",
            str(SPEC),
            "--output-path",
            str(OUT),
            "--overwrite",
            "--meta",
            "none",
        ]
    )


if __name__ == "__main__":
    main()
