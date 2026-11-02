from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from anumat_engine import slugify
from anumat_engine.engine import Engine

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "engine" / "policy-cases.json").read_text())
VECTORS = json.loads((ROOT / "engine" / "slug-vectors.json").read_text())


def _source_install_error() -> str:
    path = PACKAGE / "platform_error.py"
    spec = importlib.util.spec_from_file_location("platform_error", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"missing {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    message = module.source_install_error()
    if not isinstance(message, str):
        raise RuntimeError("source_install_error did not return a string")
    return message


def test_slugify_matches_the_shared_vectors() -> None:
    for vector in VECTORS:
        assert slugify(vector["input"]) == vector["slug"]


def test_engine_methods_match_policy_cases() -> None:
    expected = {item["python"] for item in CASES["methods"]}
    found = {name for name in dir(Engine) if not name.startswith("_") and callable(getattr(Engine, name))}
    assert found - {"close"} == expected


def test_source_install_names_the_supported_wheels() -> None:
    message = _source_install_error()
    assert "no installable build" in message
    assert "manylinux_2_17_x86_64" in message
    assert "win_amd64" in message
