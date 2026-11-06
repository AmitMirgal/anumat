from __future__ import annotations

import atexit
import base64
import json
import os
import queue
import re
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Literal, TypedDict

from anumat_engine._binary import binary_path
from anumat_engine.errors import EngineError

JsonObject = dict[str, Any]
Market = Literal["us"]
VersionStatus = Literal["proposed", "approved", "rejected", "superseded"]
_MAX_DATABASE_URL_LENGTH = 4096
_MODEL_ID = re.compile(r"^[^/\s]+/\S+$")
_POSTGRES_SCHEMES = {"postgres", "postgresql"}


class ProposeVersionResult(TypedDict):
    version: JsonObject
    diff: JsonObject
    created: bool


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

    def propose_version(
        self, *, source_id: str, document_id: str, extraction: Any, extracted_by: str
    ) -> ProposeVersionResult:
        body = _object(
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
        version = body.get("version")
        diff = body.get("diff")
        created = body.get("created")
        if not isinstance(version, dict) or not isinstance(diff, dict) or not isinstance(created, bool):
            raise EngineError("engine returned an unexpected object", code="internal")
        return {"version": version, "diff": diff, "created": created}

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

    def extract(
        self,
        pdf: bytes,
        *,
        payer: str | None = None,
        title: str | None = None,
        market: Market = "us",
    ) -> JsonObject:
        if not isinstance(pdf, (bytes, bytearray)) or len(pdf) == 0:
            raise EngineError("extract requires a non-empty PDF", code="validation_failed")
        payload: JsonObject = {"pdf": base64.b64encode(bytes(pdf)).decode("ascii"), "market": market}
        if payer is not None:
            payload["payer"] = payer
        if title is not None:
            payload["title"] = title
        return _object(self._call("extract", payload))

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
    database_url: str | None = None,
    storage: JsonObject | None = None,
    llm: JsonObject | None = None,
) -> Engine:
    config: JsonObject = {}
    if database_url is not None:
        config["databaseUrl"] = _database_url(database_url)
    storage_payload = _storage_payload(storage)
    if storage_payload is not None:
        config["storage"] = storage_payload
    llm_payload = _llm_payload(llm)
    if llm_payload is not None:
        config["llm"] = llm_payload
    process = _spawn(binary_path())
    stderr = bytearray()
    drained = threading.Event()
    assert process.stderr is not None
    threading.Thread(target=_drain, args=(process.stderr, stderr, drained), daemon=True).start()
    try:
        assert process.stdin is not None and process.stdout is not None
        process.stdin.write(json.dumps(config).encode() + b"\n")
        process.stdin.flush()
        line = _read_line(process.stdout, 60)
        if line == b"":
            raise EngineError(_startup_message("engine exited before it was ready", process, stderr, drained), code="internal")
        try:
            ready = json.loads(line.decode())
        except json.JSONDecodeError:
            raise EngineError(_startup_message("engine ready line was not JSON", process, stderr, drained), code="internal") from None
        port = ready["port"]
        token = ready["token"]
        if not isinstance(port, int) or not isinstance(token, str) or token == "":
            raise EngineError(_with_stderr("engine ready line was incomplete", stderr), code="internal")
        base_url = f"http://127.0.0.1:{port}"
        _wait_health(base_url, token, process, stderr)
        engine_config = ready.get("config")
        if not isinstance(engine_config, dict):
            raise EngineError(_with_stderr("engine ready line was incomplete", stderr), code="internal")
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


def _drain(stream: Any, sink: bytearray, done: threading.Event, limit: int = 65536) -> None:
    try:
        while True:
            chunk = stream.read(4096)
            if not chunk:
                return
            if len(sink) < limit:
                sink.extend(chunk[: limit - len(sink)])
    finally:
        done.set()


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


def _database_url(database_url: str) -> str:
    if not isinstance(database_url, str) or database_url.strip() == "":
        raise EngineError("database_url must be a postgres:// or postgresql:// URL", code="validation_failed")
    if len(database_url) > _MAX_DATABASE_URL_LENGTH:
        raise EngineError("database_url must be at most 4096 characters", code="validation_failed")
    parsed = urllib.parse.urlparse(database_url)
    if parsed.scheme not in _POSTGRES_SCHEMES or parsed.netloc == "":
        raise EngineError("database_url must be a postgres:// or postgresql:// URL", code="validation_failed")
    return database_url


def _llm_payload(llm: JsonObject | None) -> JsonObject | None:
    if llm is None:
        return None
    if not isinstance(llm, dict):
        raise EngineError("llm must be an object", code="validation_failed")
    strong = llm.get("strong")
    cheap = llm.get("cheap")
    if not isinstance(strong, str) or not isinstance(cheap, str) or strong == "" or cheap == "":
        raise EngineError("llm requires strong and cheap", code="validation_failed")
    if _MODEL_ID.fullmatch(strong) is None or _MODEL_ID.fullmatch(cheap) is None:
        raise EngineError("llm.strong and llm.cheap must be provider/model ids", code="validation_failed")
    return {"strong": strong, "cheap": cheap}


def _storage_text(storage: JsonObject, key: str) -> str:
    value = storage.get(key)
    if not isinstance(value, str) or value == "":
        raise EngineError(f"storage.{key} is required", code="validation_failed")
    return value


def _storage_payload(storage: JsonObject | None) -> JsonObject | None:
    if storage is None:
        return None
    if not isinstance(storage, dict):
        raise EngineError("storage must be an object", code="validation_failed")
    kind = storage.get("kind")
    if kind == "local":
        payload: JsonObject = {"kind": "local"}
        data_dir = storage.get("data_dir")
        if data_dir is None:
            return payload
        if not isinstance(data_dir, str) or data_dir == "":
            raise EngineError("storage.data_dir must be a non-empty path", code="validation_failed")
        payload["dataDir"] = data_dir
        return payload
    if kind == "s3":
        payload = {
            "kind": "s3",
            "region": _storage_text(storage, "region"),
            "bucket": _storage_text(storage, "bucket"),
            "accessKeyId": _storage_text(storage, "access_key_id"),
            "secretAccessKey": _storage_text(storage, "secret_access_key"),
        }
        endpoint = storage.get("endpoint")
        if endpoint is not None:
            if not isinstance(endpoint, str) or urllib.parse.urlparse(endpoint).scheme == "":
                raise EngineError("storage.endpoint must be a URL", code="validation_failed")
            payload["endpoint"] = endpoint
        return payload
    if kind == "gcs":
        payload = {"kind": "gcs", "bucket": _storage_text(storage, "bucket")}
        project_id = storage.get("project_id")
        if project_id is not None:
            if not isinstance(project_id, str) or project_id == "":
                raise EngineError("storage.project_id must be a non-empty string", code="validation_failed")
            payload["projectId"] = project_id
        key_filename = storage.get("key_filename")
        if key_filename is not None:
            if not isinstance(key_filename, str) or key_filename == "":
                raise EngineError("storage.key_filename must be a non-empty path", code="validation_failed")
            payload["keyFilename"] = key_filename
        return payload
    if kind == "supabase":
        url = _storage_text(storage, "url")
        if urllib.parse.urlparse(url).scheme == "":
            raise EngineError("storage.url must be a URL", code="validation_failed")
        return {
            "kind": "supabase",
            "url": url,
            "apiKey": _storage_text(storage, "api_key"),
            "bucket": _storage_text(storage, "bucket"),
        }
    raise EngineError("storage.kind must be local, s3, gcs, or supabase", code="validation_failed")


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


def _startup_message(message: str, process: subprocess.Popen[bytes], stderr: bytearray, drained: threading.Event) -> str:
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    drained.wait(timeout=2)
    return _with_stderr(message, stderr)


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
