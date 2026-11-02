import os
import socket
import subprocess
import time
from collections.abc import Iterator

import httpx
import pytest

from anumat_py import AnumatClient, AnumatError

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
