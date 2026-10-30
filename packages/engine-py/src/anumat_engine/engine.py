from __future__ import annotations

import atexit
import json
import os
import queue
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Literal

from anumat_engine._binary import binary_path
from anumat_engine.errors import EngineError

JsonObject = dict[str, Any]
Market = Literal["us"]
VersionStatus = Literal["proposed", "approved", "rejected", "superseded"]


class Engine:
    def __init__(
        self,
        process: subprocess.Popen[bytes],
        base_url: str,
        token: str,
        config: JsonObject,
        stderr: bytearray,
    ) -> None:
        self._process = process
        self._base_url = base_url
        self._token = token
        self._stderr = stderr
        self._closed = False
        self.config = config

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        _stop(self._process)

    def __enter__(self) -> Engine:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def register_payer(self, *, name: str, slug: str, market: Market) -> JsonObject:
        return _object(self._call("register_payer", {"name": name, "slug": slug, "market": market}))

    def get_payer(self, *, id: str) -> JsonObject:
        return _object(self._call("get_payer", {"id": id}))

    def find_payer_by_slug(self, *, slug: str) -> JsonObject | None:
        return _object_or_none(self._call("find_payer_by_slug", {"slug": slug}))

    def list_payers(self, *, limit: int = 20, cursor: str | None = None) -> JsonObject:
        return _page(self._call("list_payers", _page_input(limit, cursor)))

    def register_source(
        self,
        *,
        payer_id: str,
        title: str,
        source_url: str,
        policy_slug: str | None = None,
        market: Market | None = None,
        check_interval_hours: int | None = None,
        enabled: bool | None = None,
    ) -> JsonObject:
        payload: JsonObject = {"payer_id": payer_id, "title": title, "source_url": source_url}
        if policy_slug is not None:
            payload["policy_slug"] = policy_slug
        if market is not None:
            payload["market"] = market
        if check_interval_hours is not None:
            payload["check_interval_hours"] = check_interval_hours
        if enabled is not None:
            payload["enabled"] = enabled
        return _object(self._call("register_source", payload))

    def get_source(self, *, id: str) -> JsonObject:
        return _object(self._call("get_source", {"id": id}))

    def find_source_by_policy_key(self, *, policy_key: str) -> JsonObject | None:
        return _object_or_none(self._call("find_source_by_policy_key", {"policy_key": policy_key}))

    def list_sources(self, *, limit: int = 20, cursor: str | None = None) -> JsonObject:
        return _page(self._call("list_sources", _page_input(limit, cursor)))

    def check_source(self, *, source_id: str) -> JsonObject:
        return _object(self._call("check_source", {"source_id": source_id}))

    def due_sources(self) -> list[JsonObject]:
        return _objects(self._call("due_sources", {}))

    def check_due_sources(self) -> list[JsonObject]:
        return _objects(self._call("check_due_sources", {}))

    def propose_version(self, *, source_id: str, document_id: str, extraction: Any, extracted_by: str) -> JsonObject:
        return _object(
            self._call(
                "propose_version",
                {
                    "source_id": source_id,
                    "document_id": document_id,
                    "extraction": extraction,
                    "extracted_by": extracted_by,
                },
            )
        )

    def approve_version(self, *, version_id: str, approved_by: str) -> JsonObject:
        return _object(self._call("approve_version", {"version_id": version_id, "approved_by": approved_by}))

    def reject_version(self, *, version_id: str, rejected_by: str, reason: str) -> JsonObject:
        return _object(
            self._call(
                "reject_version",
                {"version_id": version_id, "rejected_by": rejected_by, "reason": reason},
            )
        )

    def get_published_policy(self, *, policy_key: str) -> JsonObject:
        return _object(self._call("get_published_policy", {"policy_key": policy_key}))

    def get_published_version(self, *, policy_key: str, version: int) -> JsonObject:
        return _object(self._call("get_published_version", {"policy_key": policy_key, "version": version}))

    def list_published_versions(self, *, policy_key: str, limit: int = 20, cursor: str | None = None) -> JsonObject:
        return _page(self._call("list_published_versions", _page_input(limit, cursor, policy_key=policy_key)))

    def get_version(self, *, id: str) -> JsonObject:
        return _object(self._call("get_version", {"id": id}))

    def list_versions(
        self,
        *,
        limit: int = 20,
        cursor: str | None = None,
        status: VersionStatus | None = None,
        policy_key: str | None = None,
    ) -> JsonObject:
        payload = _page_input(limit, cursor)
        if status is not None:
            payload["status"] = status
        if policy_key is not None:
            payload["policy_key"] = policy_key
        return _page(self._call("list_versions", payload))

    def get_diff(self, *, id: str) -> JsonObject:
        return _object(self._call("get_diff", {"id": id}))

    def diff_for_version(self, *, version_id: str) -> JsonObject:
        return _object(self._call("diff_for_version", {"version_id": version_id}))

    def save_diff_notes(self, *, diff_id: str, summary: str | None, review: Any) -> JsonObject:
        return _object(self._call("save_diff_notes", {"diff_id": diff_id, "summary": summary, "review": review}))

    def _call(self, method: str, payload: JsonObject) -> Any:
        if self._closed:
            raise EngineError("engine is closed", code="closed")
        body = json.dumps({"method": method, "input": payload}).encode()
        request = urllib.request.Request(
            f"{self._base_url}/rpc",
            data=body,
            method="POST",
            headers={
                "authorization": f"Bearer {self._token}",
                "content-type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                parsed = json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            raise _error_from_http(error) from None
        except urllib.error.URLError as error:
            raise EngineError(f"engine request failed: {error.reason}", code="unavailable") from None
        if not isinstance(parsed, dict) or "result" not in parsed:
            raise EngineError("engine returned an unexpected response", code="internal")
        return parsed["result"]


def create_engine(
    database_url: str,
    storage: JsonObject | None = None,
    llm: JsonObject | None = None,
) -> Engine:
    config: JsonObject = {"databaseUrl": database_url}
    storage_payload = _storage_payload(storage)
    if storage_payload is not None:
        config["storage"] = storage_payload
    if llm is not None:
        strong = llm.get("strong")
        cheap = llm.get("cheap")
        if not isinstance(strong, str) or not isinstance(cheap, str):
            raise EngineError("llm requires strong and cheap", code="validation_failed")
        config["llm"] = {"strong": strong, "cheap": cheap}
    process = _spawn(binary_path())
    stderr = bytearray()
    assert process.stderr is not None
    threading.Thread(target=_drain, args=(process.stderr, stderr), daemon=True).start()
    try:
        assert process.stdin is not None and process.stdout is not None
        process.stdin.write(json.dumps(config).encode() + b"\n")
        process.stdin.flush()
        line = _read_line(process.stdout, 60)
        if line == b"":
            raise EngineError(_with_stderr("engine exited before it was ready", stderr), code="internal")
        ready = json.loads(line.decode())
        port = ready["port"]
        token = ready["token"]
        if not isinstance(port, int) or not isinstance(token, str) or token == "":
            raise EngineError("engine ready line was incomplete", code="internal")
        base_url = f"http://127.0.0.1:{port}"
        _wait_health(base_url, token, process, stderr)
        engine_config = ready.get("config")
        if not isinstance(engine_config, dict):
            raise EngineError("engine ready line was incomplete", code="internal")
        engine = Engine(process, base_url, token, engine_config, stderr)
    except Exception:
        _stop(process)
        raise
    atexit.register(engine.close)
    return engine


def _spawn(binary: os.PathLike[str]) -> subprocess.Popen[bytes]:
    env = os.environ.copy()
    env["ANUMAT_ENGINE_SIDECAR"] = "1"
    command = [os.fspath(binary), "serve"]
    if os.name == "posix":
        return subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            start_new_session=True,
        )
    return subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )


def _drain(stream: Any, sink: bytearray, limit: int = 65536) -> None:
    while True:
        chunk = stream.read(4096)
        if not chunk:
            return
        if len(sink) < limit:
            sink.extend(chunk[: limit - len(sink)])


def _read_line(stream: Any, timeout: float) -> bytes:
    holder: queue.Queue[bytes] = queue.Queue(maxsize=1)

    def run() -> None:
        holder.put(stream.readline())

    threading.Thread(target=run, daemon=True).start()
    try:
        return holder.get(timeout=timeout)
    except queue.Empty as error:
        raise EngineError("engine did not become ready", code="internal") from error


def _wait_health(base_url: str, token: str, process: subprocess.Popen[bytes], stderr: bytearray) -> None:
    deadline = time.monotonic() + 30
    last = "engine health check failed"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise EngineError(_with_stderr("engine exited during the health check", stderr), code="internal")
        request = urllib.request.Request(
            f"{base_url}/health",
            headers={"authorization": f"Bearer {token}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                body = json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            if error.code != 503:
                raise _error_from_http(error) from None
            last = "engine is not ready"
        except urllib.error.URLError as error:
            last = f"engine health check failed: {error.reason}"
        else:
            if isinstance(body, dict) and body.get("status") == "ok":
                return
            last = "engine health check failed"
        time.sleep(0.05)
    raise EngineError(last, code="internal")


def _storage_payload(storage: JsonObject | None) -> JsonObject | None:
    if storage is None:
        return None
    kind = storage.get("kind")
    if kind == "local":
        payload: JsonObject = {"kind": "local"}
        data_dir = storage.get("data_dir")
        if isinstance(data_dir, str):
            payload["dataDir"] = data_dir
        return payload
    if kind == "s3":
        payload = {
            "kind": "s3",
            "region": storage["region"],
            "bucket": storage["bucket"],
            "accessKeyId": storage["access_key_id"],
            "secretAccessKey": storage["secret_access_key"],
        }
        endpoint = storage.get("endpoint")
        if isinstance(endpoint, str):
            payload["endpoint"] = endpoint
        return payload
    raise EngineError("storage.kind must be local or s3", code="validation_failed")


def _page_input(limit: int, cursor: str | None, **extra: Any) -> JsonObject:
    payload: JsonObject = {"limit": limit, **extra}
    if cursor is not None:
        payload["cursor"] = cursor
    return payload


def _object(value: Any) -> JsonObject:
    if not isinstance(value, dict):
        raise EngineError("engine returned an unexpected object", code="internal")
    return value


def _object_or_none(value: Any) -> JsonObject | None:
    if value is None:
        return None
    return _object(value)


def _objects(value: Any) -> list[JsonObject]:
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise EngineError("engine returned an unexpected list", code="internal")
    return value


def _page(value: Any) -> JsonObject:
    page = _object(value)
    items = page.get("items")
    cursor = page.get("nextCursor")
    if not isinstance(items, list) or (cursor is not None and not isinstance(cursor, str)):
        raise EngineError("engine returned an unexpected page", code="internal")
    return page


def _error_from_http(error: urllib.error.HTTPError) -> EngineError:
    raw = error.read().decode()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict) and isinstance(parsed.get("error"), dict):
        body = parsed["error"]
        message = body.get("message")
        code = body.get("code")
        details = body.get("details")
        return EngineError(
            message if isinstance(message, str) else error.reason,
            code=code if isinstance(code, str) else "internal",
            details=details if isinstance(details, dict) else None,
        )
    return EngineError(error.reason or "engine request failed", code="internal")


def _with_stderr(message: str, stderr: bytearray) -> str:
    detail = bytes(stderr).decode(errors="replace").strip()
    if detail == "":
        return message
    return f"{message}: {detail}"


def _stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if process.stdin is not None:
        try:
            process.stdin.close()
        except OSError:
            pass
    try:
        process.wait(timeout=5)
        return
    except subprocess.TimeoutExpired:
        pass
    _signal(process, signal.SIGTERM)
    try:
        process.wait(timeout=2)
        return
    except subprocess.TimeoutExpired:
        _signal(process, getattr(signal, "SIGKILL", signal.SIGTERM))
        process.wait(timeout=2)


def _signal(process: subprocess.Popen[bytes], sig: signal.Signals) -> None:
    if os.name == "posix":
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        return
    if sig == getattr(signal, "SIGKILL", None):
        process.kill()
        return
    process.terminate()
