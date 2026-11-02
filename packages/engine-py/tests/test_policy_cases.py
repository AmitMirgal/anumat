from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import uuid
from pathlib import Path
from typing import Any

import pytest
from anumat_engine import EngineError, create_engine

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "packages" / "engine" / "test" / "fixtures" / "policy_cases.json"
ENGINE = ROOT / "packages" / "engine"
ADMIN = "postgres://anumat:anumat@127.0.0.1:5432/postgres"
DATABASE = "postgres://anumat:anumat@127.0.0.1:5432/anumat_engine_parity"

EXPECTED = {
    "TEST-PA-05": "validation_failed",
    "TEST-PA-06": "validation_failed",
    "TEST-PA-07": "conflict",
    "TEST-PA-08": "validation_failed",
    "TEST-PA-10": "policy_not_published",
}


def test_fixture_names_the_expected_error_codes() -> None:
    cases = json.loads(FIXTURE.read_text())
    found = {item["id"]: item["expect"] for item in cases if "expect" in item}
    assert found == EXPECTED


def test_python_policy_cases_match_the_shared_fixture(tmp_path: Path) -> None:
    cases = json.loads(FIXTURE.read_text())
    _recreate_database()
    os.environ["ANUMAT_ENGINE_BINARY"] = str(_sidecar_wrapper(tmp_path))
    engine = create_engine(database_url=DATABASE, storage={"kind": "local", "data_dir": str(tmp_path / "data")})
    try:
        for item in cases:
            outcome = _run(engine, item)
            assert outcome["code"] == item.get("expect"), item["id"]
            if item["action"] == "approve" and outcome["code"] is None:
                assert outcome["status"] == "approved", item["id"]
            if item["action"] == "reject" and outcome["code"] is None:
                assert outcome["status"] == "rejected", item["id"]
                assert outcome["reason"] == item["reason"], item["id"]
            if item["action"] == "propose_only" and outcome["code"] is None:
                assert outcome["status"] == "proposed", item["id"]
                with pytest.raises(EngineError) as raised:
                    engine.get_published_policy(policy_key=outcome["policy_key"])
                assert raised.value.code == "policy_not_published"
    finally:
        engine.close()
        os.environ.pop("ANUMAT_ENGINE_BINARY", None)


def _run(engine: Any, item: dict[str, Any]) -> dict[str, Any]:
    try:
        action = item["action"]
        if action == "get_published":
            engine.get_published_policy(policy_key=item["lookup_policy_key"])
            return {"code": None, "status": None, "policy_key": item["lookup_policy_key"], "reason": None}
        if action in {"register_only", "propose_only", "approve", "reject"}:
            return _mutate(engine, item)
        raise AssertionError(action)
    except EngineError as error:
        return {"code": error.code, "status": None, "policy_key": None, "reason": None}


def _mutate(engine: Any, item: dict[str, Any]) -> dict[str, Any]:
    payer_input = item["payer"]
    payer = engine.register_payer(name=payer_input["name"], slug=payer_input["slug"], market=payer_input["market"])
    source_input = item.get("source")
    if source_input is None:
        return {"code": None, "status": None, "policy_key": None, "reason": None}
    payload: dict[str, Any] = {
        "payer_id": payer["id"],
        "title": source_input["title"],
        "source_url": source_input["source_url"],
    }
    if "policy_slug" in source_input:
        payload["policy_slug"] = source_input["policy_slug"]
    if "check_interval_hours" in source_input:
        payload["check_interval_hours"] = source_input["check_interval_hours"]
    source = engine.register_source(**payload)
    if item["action"] == "register_only":
        return {"code": None, "status": None, "policy_key": source["policyKey"], "reason": None}
    document_id = _seed_document(source["id"], item["id"])
    proposed = _version(
        engine.propose_version(
            source_id=source["id"],
            document_id=document_id,
            extraction=_proposal(item),
            extracted_by="TEST",
        )
    )
    if item["action"] == "propose_only":
        return {"code": None, "status": proposed["status"], "policy_key": source["policyKey"], "reason": proposed["rejectReason"]}
    if item["action"] == "approve":
        approved = _version(engine.approve_version(version_id=proposed["id"], approved_by="TEST"))
        return {"code": None, "status": approved["status"], "policy_key": source["policyKey"], "reason": approved["rejectReason"]}
    rejected = _version(
        engine.reject_version(version_id=proposed["id"], rejected_by="TEST", reason=item["reason"])
    )
    return {"code": None, "status": rejected["status"], "policy_key": source["policyKey"], "reason": rejected["rejectReason"]}


def _proposal(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("extraction") or {}
    criteria = raw.get("criteria") or ["TEST criteria"]
    return {
        "market": "us",
        "title": (item.get("source") or {}).get("title") or "TEST Policy",
        "payer": (item.get("payer") or {}).get("name") or "TEST Payer",
        "policy_number": None,
        "effective_date": None,
        "revision_date": None,
        "auth_type": "prior_authorization",
        "codes": [{"system": "CPT", "code": code} for code in raw.get("codes") or []],
        "indications": [{"name": "TEST indication", "match": "all", "criteria": [{"text": text} for text in criteria]}],
        "exclusions": [],
        "documentation_requirements": [],
        "site_of_care": [],
    }


def _version(value: Any) -> dict[str, Any]:
    nested = value.get("version") if isinstance(value, dict) else None
    if isinstance(nested, dict) and "id" in nested:
        return _version(nested)
    if not isinstance(value, dict) or "id" not in value or "status" not in value:
        raise AssertionError("policy call did not return a version")
    return {"id": value["id"], "status": value["status"], "rejectReason": value.get("rejectReason")}


def _seed_document(source_id: str, content: str) -> str:
    uuid.UUID(source_id)
    digest = hashlib.sha256(content.encode()).hexdigest()
    artifact_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    sql = f"""
    INSERT INTO policy_artifacts (id, source_id, content_sha256, storage_path, mime, byte_size)
    VALUES ('{artifact_id}', '{source_id}', '{digest}', 'pdf/{digest}.pdf', 'application/pdf', {len(content)});
    INSERT INTO policy_documents (id, artifact_id, status, converter, markdown_path, updated_at)
    VALUES ('{document_id}', '{artifact_id}', 'converted', 'anydoc', 'markdown/{digest}.md', CURRENT_TIMESTAMP);
    """
    subprocess.check_call(["psql", DATABASE, "-v", "ON_ERROR_STOP=1", "-c", sql])
    return document_id


def _recreate_database() -> None:
    subprocess.check_call(
        [
            "psql",
            ADMIN,
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'anumat_engine_parity' AND pid <> pg_backend_pid()",
            "-c",
            "DROP DATABASE IF EXISTS anumat_engine_parity",
            "-c",
            "CREATE DATABASE anumat_engine_parity OWNER anumat",
        ]
    )
    subprocess.check_call(
        ["pnpm", "--filter", "@anumat/db", "exec", "prisma", "migrate", "deploy"],
        cwd=ROOT,
        env={**os.environ, "DATABASE_URL": DATABASE},
    )


def _sidecar_wrapper(tmp_path: Path) -> Path:
    path = tmp_path / "anumat-engine"
    path.write_text(
        "#!/bin/sh\n"
        f"cd {ENGINE}\n"
        "node scripts/bundle-sidecar.mjs >&2\n"
        "exec bun .sidecar/sidecar.mjs \"$@\"\n"
    )
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path
