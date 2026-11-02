from __future__ import annotations

import json
import platform
from pathlib import Path


def source_install_error() -> str:
    tags = [
        item["platform"]
        for item in json.loads((Path(__file__).parent / "platforms.json").read_text())
        if isinstance(item, dict) and isinstance(item.get("platform"), str)
    ]
    listed = ", ".join(tags)
    detected = f"{platform.system().lower()} {platform.machine()}"
    return (
        "anumat-engine has no installable build for this platform "
        f"({detected}). Install a wheel for one of: {listed}."
    )
