from __future__ import annotations

import os
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        if version != "standard":
            return
        platform = os.environ.get("ANUMAT_ENGINE_PLATFORM", "")
        if platform == "":
            raise RuntimeError("Set ANUMAT_ENGINE_PLATFORM to the wheel platform tag")
        binary_name = "anumat-engine.exe" if platform.startswith("win_") else "anumat-engine"
        binary = Path(self.root) / "src" / "anumat_engine" / "bin" / binary_name
        if not binary.is_file():
            raise RuntimeError(f"Missing {binary}")
        build_data["pure_python"] = False
        build_data["tag"] = f"py3-none-{platform}"
        force_include = build_data.get("force_include")
        if not isinstance(force_include, dict):
            force_include = {}
            build_data["force_include"] = force_include
        force_include[str(binary)] = f"anumat_engine/bin/{binary_name}"
