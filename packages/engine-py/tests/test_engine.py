from __future__ import annotations

from pathlib import Path

import pytest

from anumat_engine import EngineError, create_engine, slugify
from anumat_engine.cli import main

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
