import json
import os
import socket
import subprocess
import time
from collections.abc import Iterator
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import httpx
import pytest

from anumat_py import AnumatClient, AnumatError
from anumat_py.client import _body

API_KEY = "test-key-0123456789abcdef"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="module")
def api_url() -> Iterator[str]:
    port = _free_port()
    env = os.environ.copy()
    env.update(
        {
            "HOST": "127.0.0.1",
            "PORT": str(port),
            "DATABASE_URL": env.get(
                "TEST_DATABASE_URL", "postgres://anumat:anumat@127.0.0.1:5432/anumat_test"
            ),
            "ANUMAT_API_KEYS": f"tester:{API_KEY}",
            "ANUMAT_LLM_MODE": "replay",
            "LOG_LEVEL": "silent",
        }
    )
    process = subprocess.Popen(
        [
            "pnpm",
            "--filter",
            "@anumat/api",
            "exec",
            "tsx",
            "--env-file-if-exists=../../.env",
            "src/main.ts",
        ],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 30
    last = ""
    while time.time() < deadline:
        if process.poll() is not None:
            break
        try:
            response = httpx.get(f"{base}/health", timeout=1)
            if response.status_code == 200:
                break
            last = f"status {response.status_code}"
        except httpx.HTTPError as error:
            last = str(error)
        time.sleep(0.2)
    else:
        process.kill()
        raise RuntimeError(f"API did not listen ({last})")
    if process.poll() is not None:
        raise RuntimeError(f"API exited {process.returncode} before listening")
    yield base
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def test_client_rejects_a_bad_base_url() -> None:
    try:
        AnumatClient("ftp://example.test", API_KEY)
    except AnumatError as error:
        assert error.code == "validation_failed"
    else:
        raise AssertionError("expected AnumatError")


def test_client_exposes_the_rest_methods() -> None:
    names = [
        "create_payer",
        "list_payers",
        "create_source",
        "list_sources",
        "get_source",
        "check_source",
        "get_policy",
        "list_policy_versions",
        "get_policy_version",
        "list_versions",
        "get_version",
        "approve_version",
        "reject_version",
        "get_diff",
    ]
    for name in names:
        assert callable(getattr(AnumatClient, name))
        assert callable(getattr(AnumatClient, f"{name}_async"))


def test_list_payers(api_url: str) -> None:
    client = AnumatClient(api_url, API_KEY)
    page = client.list_payers(limit=20)
    assert isinstance(page["items"], list)
    assert page["next_cursor"] is None or isinstance(page["next_cursor"], str)


def test_none_id_is_a_validation_error() -> None:
    client = AnumatClient("http://127.0.0.1:9", API_KEY)
    with pytest.raises(AnumatError) as raised:
        client.get_source(cast(str, None))
    assert raised.value.code == "validation_failed"
    with pytest.raises(AnumatError) as checked:
        client.check_source(cast(str, None))
    assert checked.value.code == "validation_failed"


def test_transport_errors_are_anumat_errors() -> None:
    client = AnumatClient("http://127.0.0.1:1", API_KEY)
    with pytest.raises(AnumatError) as raised:
        client.list_payers()
    assert raised.value.code == "network_error"


def test_error_bodies_keep_the_server_message_and_code() -> None:
    flat = SimpleNamespace(
        status_code=404,
        parsed=None,
        content=json.dumps({"message": "Version TEST-missing not found", "code": "NOT_FOUND"}).encode(),
    )
    with pytest.raises(AnumatError) as raised:
        _body(flat)
    assert raised.value.status == 404
    assert raised.value.code == "NOT_FOUND"
    assert "TEST-missing" in str(raised.value)
    assert str(raised.value) != "Anumat returned HTTP 404"

    nested = SimpleNamespace(
        status_code=404,
        parsed=None,
        content=json.dumps(
            {"error": {"code": "not_found", "message": "Version TEST-missing not found"}}
        ).encode(),
    )
    with pytest.raises(AnumatError) as wrapped:
        _body(nested)
    assert wrapped.value.code == "not_found"
    assert "TEST-missing" in str(wrapped.value)


def test_check_and_approve_send_json_and_keep_not_found(api_url: str) -> None:
    client = AnumatClient(api_url, API_KEY)
    suffix = uuid4().hex[:12]
    payer = client.create_payer(name="TEST-Payer", slug=f"test-{suffix}", market="us")
    source = client.create_source(
        payer_id=str(payer["id"]),
        title="TEST-Policy",
        source_url=f"http://127.0.0.1:1/TEST-policy-{suffix}.pdf",
    )
    checked = client.check_source(str(source["id"]))
    assert isinstance(checked["watch_run"], dict)
    missing = str(uuid4())
    with pytest.raises(AnumatError) as approved:
        client.approve_version(missing)
    assert approved.value.status == 404
    assert approved.value.code == "NOT_FOUND"
    assert "not found" in str(approved.value).lower()
    assert str(approved.value) != "Anumat returned HTTP 404"
    with pytest.raises(AnumatError) as rejected:
        client.reject_version(missing, reason="TEST-reject")
    assert rejected.value.status == 404
    assert rejected.value.code == "NOT_FOUND"
    assert "not found" in str(rejected.value).lower()
