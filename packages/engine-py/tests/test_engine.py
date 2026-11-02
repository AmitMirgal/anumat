from __future__ import annotations

from pathlib import Path
from typing import get_type_hints

import pytest

from anumat_engine import EngineError, create_engine, slugify
from anumat_engine.cli import main
from anumat_engine.engine import Engine, ProposeVersionResult

FAKE = Path(__file__).with_name("fake_sidecar.py")
DATABASE_URL = "postgres://anumat:anumat@127.0.0.1:5432/anumat"


def test_slugify_matches_the_engine_rules() -> None:
    assert slugify("United Health") == "united-health"
    assert slugify("  A--B  ") == "a-b"


def test_create_engine_lists_payers_and_close_stops_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", str(FAKE))
    engine = create_engine(database_url=DATABASE_URL)
    try:
        assert engine.list_payers() == {"items": [], "nextCursor": None}
        assert engine.config["databaseUrl"] == DATABASE_URL
        assert engine.config["storage"] == {"kind": "local", "dataDir": "./data/policies"}
    finally:
        engine.close()
    assert engine._process.poll() is not None
    with pytest.raises(EngineError) as raised:
        engine.list_payers()
    assert raised.value.code == "closed"
    engine.close()


def test_with_block_closes_the_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", str(FAKE))
    with create_engine(database_url=DATABASE_URL, storage={"kind": "local", "data_dir": "policies"}) as engine:
        assert engine.list_payers(limit=5)["items"] == []
    with pytest.raises(EngineError) as raised:
        engine.list_payers()
    assert raised.value.code == "closed"


def test_migrate_requires_a_database_url(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", str(FAKE))
    with pytest.raises(SystemExit) as raised:
        main(["migrate"])
    assert raised.value.code == 1
    assert "Usage: anumat-engine migrate --db <url>" in capsys.readouterr().err


def test_migrate_runs_the_binary(monkeypatch: pytest.MonkeyPatch, capfd: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", str(FAKE))
    with pytest.raises(SystemExit) as raised:
        main(["migrate", "--db", DATABASE_URL])
    assert raised.value.code == 0
    assert capfd.readouterr().out.strip() == "Applied 20260929061425_init"


def test_storage_kind_is_rejected_before_start(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", str(FAKE))
    with pytest.raises(EngineError) as raised:
        create_engine(database_url=DATABASE_URL, storage={"kind": "disk"})
    assert raised.value.code == "validation_failed"


def test_incomplete_storage_and_database_url_fail_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", str(FAKE))
    with pytest.raises(EngineError) as missing:
        create_engine(database_url="", storage={"kind": "s3"})
    assert missing.value.code == "validation_failed"
    with pytest.raises(EngineError) as partial:
        create_engine(database_url=DATABASE_URL, storage={"kind": "s3", "region": "us-east-1"})
    assert partial.value.code == "validation_failed"
    assert "required" in str(partial.value)


def test_bad_model_ids_fail_before_start(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", "/no/such/anumat-engine")
    with pytest.raises(EngineError) as raised:
        create_engine(database_url=DATABASE_URL, llm={"strong": "bad", "cheap": "bad"})
    assert raised.value.code == "validation_failed"


def test_database_url_is_rejected_before_start(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", "/no/such/anumat-engine")
    with pytest.raises(EngineError) as long_url:
        create_engine(database_url="postgres://anumat:anumat@127.0.0.1:5432/" + ("a" * 5000))
    assert long_url.value.code == "validation_failed"
    with pytest.raises(EngineError) as scheme:
        create_engine(database_url="http://example.test/db")
    assert scheme.value.code == "validation_failed"


def test_propose_version_return_type() -> None:
    assert get_type_hints(Engine.propose_version)["return"] is ProposeVersionResult


def test_release_script_builds_an_sdist_without_pushing() -> None:
    root = Path(__file__).resolve().parents[3]
    script = (root / "scripts" / "release-engine-py.sh").read_text()
    assert "uv build --sdist --package anumat-engine --out-dir dist" in script
    for line in script.splitlines():
        if "git push" in line:
            assert line.lstrip().startswith("echo ")
    readme = (root / "packages" / "engine-py" / "README.md").read_text()
    assert "source distribution" in readme.lower()


def test_startup_failure_includes_stderr(monkeypatch: pytest.MonkeyPatch) -> None:
    crash = Path(__file__).with_name("crash_sidecar.py")
    monkeypatch.setenv("ANUMAT_ENGINE_BINARY", str(crash))
    with pytest.raises(EngineError) as raised:
        create_engine(database_url=DATABASE_URL)
    assert raised.value.code == "internal"
    assert "z is not defined" in str(raised.value)
