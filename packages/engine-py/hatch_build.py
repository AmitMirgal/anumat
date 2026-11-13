from __future__ import annotations

import importlib.util
import os
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


def _source_install_error() -> str:
    path = Path(__file__).with_name("platform_error.py")
    spec = importlib.util.spec_from_file_location("_anumat_platform_error", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Missing {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    message = module.source_install_error()
    if not isinstance(message, str) or message == "":
        raise RuntimeError(f"{path} did not return an install error")
    return message


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        if version != "standard" or self.target_name != "wheel":
            return
        platform = os.environ.get("ANUMAT_ENGINE_PLATFORM", "")
        if platform == "":
            raise RuntimeError(_source_install_error())
        binary_name = "anumat-engine.exe" if platform.startswith("win_") else "anumat-engine"
        binary = Path(self.root) / "src" / "anumat_engine" / "bin" / binary_name
        native = Path(self.root) / "src" / "anumat_engine" / "bin" / "anydoc.node"
        if not binary.is_file():
            raise RuntimeError(f"Missing {binary}")
        if not native.is_file():
            raise RuntimeError(f"Missing {native}")
        build_data["pure_python"] = False
        build_data["tag"] = f"py3-none-{platform}"
        force_include = build_data.get("force_include")
        if not isinstance(force_include, dict):
            force_include = {}
            build_data["force_include"] = force_include
        force_include[str(binary)] = f"anumat_engine/bin/{binary_name}"
        force_include[str(native)] = "anumat_engine/bin/anydoc.node"
