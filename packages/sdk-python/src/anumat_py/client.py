"""Anumat API client."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any, Literal
from urllib.parse import urlparse
from uuid import UUID

import httpx

from anumat_py._generated.api.default.approve_version import (
    asyncio_detailed as approve_version_async,
)
from anumat_py._generated.api.default.approve_version import sync_detailed as approve_version
from anumat_py._generated.api.default.check_source import asyncio_detailed as check_source_async
from anumat_py._generated.api.default.check_source import sync_detailed as check_source
from anumat_py._generated.api.default.create_payer import asyncio_detailed as create_payer_async
from anumat_py._generated.api.default.create_payer import sync_detailed as create_payer
from anumat_py._generated.api.default.create_source import asyncio_detailed as create_source_async
from anumat_py._generated.api.default.create_source import sync_detailed as create_source
from anumat_py._generated.api.default.get_diff import asyncio_detailed as get_diff_async
from anumat_py._generated.api.default.get_diff import sync_detailed as get_diff
from anumat_py._generated.api.default.get_policy import asyncio_detailed as get_policy_async
from anumat_py._generated.api.default.get_policy import sync_detailed as get_policy
from anumat_py._generated.api.default.get_policy_version import (
    asyncio_detailed as get_policy_version_async,
)
from anumat_py._generated.api.default.get_policy_version import sync_detailed as get_policy_version
from anumat_py._generated.api.default.get_source import asyncio_detailed as get_source_async
from anumat_py._generated.api.default.get_source import sync_detailed as get_source
from anumat_py._generated.api.default.get_version import asyncio_detailed as get_version_async
from anumat_py._generated.api.default.get_version import sync_detailed as get_version
from anumat_py._generated.api.default.list_payers import asyncio_detailed as list_payers_async
from anumat_py._generated.api.default.list_payers import sync_detailed as list_payers
from anumat_py._generated.api.default.list_policy_versions import (
    asyncio_detailed as list_policy_versions_async,
)
from anumat_py._generated.api.default.list_policy_versions import (
    sync_detailed as list_policy_versions,
)
from anumat_py._generated.api.default.list_sources import asyncio_detailed as list_sources_async
from anumat_py._generated.api.default.list_sources import sync_detailed as list_sources
from anumat_py._generated.api.default.list_versions import asyncio_detailed as list_versions_async
from anumat_py._generated.api.default.list_versions import sync_detailed as list_versions
from anumat_py._generated.api.default.reject_version import asyncio_detailed as reject_version_async
from anumat_py._generated.api.default.reject_version import sync_detailed as reject_version
from anumat_py._generated.client import AuthenticatedClient
from anumat_py._generated.models.approve_version_body import ApproveVersionBody
from anumat_py._generated.models.check_source_body import CheckSourceBody
from anumat_py._generated.models.create_payer_body import CreatePayerBody
from anumat_py._generated.models.create_payer_body_market import CreatePayerBodyMarket
from anumat_py._generated.models.create_source_body import CreateSourceBody
from anumat_py._generated.models.create_source_body_market import CreateSourceBodyMarket
from anumat_py._generated.models.list_versions_status import ListVersionsStatus
from anumat_py._generated.models.reject_version_body import RejectVersionBody
from anumat_py._generated.types import UNSET, Unset
from anumat_py.errors import AnumatError

JsonObject = dict[str, Any]
VersionStatus = str


class AnumatClient:
    """Sync and async client for the REST API at `{base_url}/api/v1`."""

    def __init__(self, base_url: str, api_key: str) -> None:
        root = _base_url(base_url)
        token = _api_key(api_key)
        self._generated = AuthenticatedClient(base_url=f"{root}/api/v1", token=token)

    @property
    def generated(self) -> AuthenticatedClient:
        return self._generated

    def create_payer(self, *, name: str, slug: str, market: str) -> JsonObject:
        return _call(lambda: create_payer(client=self._generated, body=_payer_body(name, slug, market)))

    async def create_payer_async(self, *, name: str, slug: str, market: str) -> JsonObject:
        return await _call_async(
            lambda: create_payer_async(client=self._generated, body=_payer_body(name, slug, market))
        )

    def list_payers(self, *, limit: int = 20, cursor: str | None = None) -> JsonObject:
        return _call(lambda: list_payers(client=self._generated, limit=limit, cursor=_optional(cursor)))

    async def list_payers_async(self, *, limit: int = 20, cursor: str | None = None) -> JsonObject:
        return await _call_async(
            lambda: list_payers_async(client=self._generated, limit=limit, cursor=_optional(cursor))
        )

    def create_source(
        self,
        *,
        payer_id: str,
        title: str,
        source_url: str,
        policy_slug: str | None = None,
        market: str | None = None,
        adapter_type: str | None = None,
        check_interval_hours: int | None = None,
        enabled: bool | None = None,
    ) -> JsonObject:
        return _call(
            lambda: create_source(
                client=self._generated,
                body=_source_body(
                    payer_id,
                    title,
                    source_url,
                    policy_slug,
                    market,
                    adapter_type,
                    check_interval_hours,
                    enabled,
                ),
            )
        )

    async def create_source_async(
        self,
        *,
        payer_id: str,
        title: str,
        source_url: str,
        policy_slug: str | None = None,
        market: str | None = None,
        adapter_type: str | None = None,
        check_interval_hours: int | None = None,
        enabled: bool | None = None,
    ) -> JsonObject:
        return await _call_async(
            lambda: create_source_async(
                client=self._generated,
                body=_source_body(
                    payer_id,
                    title,
                    source_url,
                    policy_slug,
                    market,
                    adapter_type,
                    check_interval_hours,
                    enabled,
                ),
            )
        )

    def list_sources(self, *, limit: int = 20, cursor: str | None = None) -> JsonObject:
        return _call(lambda: list_sources(client=self._generated, limit=limit, cursor=_optional(cursor)))

    async def list_sources_async(self, *, limit: int = 20, cursor: str | None = None) -> JsonObject:
        return await _call_async(
            lambda: list_sources_async(client=self._generated, limit=limit, cursor=_optional(cursor))
        )

    def get_source(self, source_id: str) -> JsonObject:
        return _call(lambda: get_source(_uuid(source_id), client=self._generated))

    async def get_source_async(self, source_id: str) -> JsonObject:
        return await _call_async(lambda: get_source_async(_uuid(source_id), client=self._generated))

    def check_source(self, source_id: str) -> JsonObject:
        return _call(
            lambda: check_source(_uuid(source_id), client=self._generated, body=CheckSourceBody())
        )

    async def check_source_async(self, source_id: str) -> JsonObject:
        return await _call_async(
            lambda: check_source_async(_uuid(source_id), client=self._generated, body=CheckSourceBody())
        )

    def get_policy(self, policy_key: str) -> JsonObject:
        return _call(lambda: get_policy(policy_key, client=self._generated))

    async def get_policy_async(self, policy_key: str) -> JsonObject:
        return await _call_async(lambda: get_policy_async(policy_key, client=self._generated))

    def list_policy_versions(
        self, policy_key: str, *, limit: int = 20, cursor: str | None = None
    ) -> JsonObject:
        return _call(
            lambda: list_policy_versions(
                policy_key, client=self._generated, limit=limit, cursor=_optional(cursor)
            )
        )

    async def list_policy_versions_async(
        self, policy_key: str, *, limit: int = 20, cursor: str | None = None
    ) -> JsonObject:
        return await _call_async(
            lambda: list_policy_versions_async(
                policy_key, client=self._generated, limit=limit, cursor=_optional(cursor)
            )
        )

    def get_policy_version(self, policy_key: str, version: int) -> JsonObject:
        return _call(lambda: get_policy_version(policy_key, version, client=self._generated))

    async def get_policy_version_async(self, policy_key: str, version: int) -> JsonObject:
        return await _call_async(
            lambda: get_policy_version_async(policy_key, version, client=self._generated)
        )

    def list_versions(
        self,
        *,
        limit: int = 20,
        cursor: str | None = None,
        status: VersionStatus | None = None,
        policy_key: str | None = None,
    ) -> JsonObject:
        return _call(
            lambda: list_versions(
                client=self._generated,
                limit=limit,
                cursor=_optional(cursor),
                status=_status(status),
                policy_key=_optional(policy_key),
            )
        )

    async def list_versions_async(
        self,
        *,
        limit: int = 20,
        cursor: str | None = None,
        status: VersionStatus | None = None,
        policy_key: str | None = None,
    ) -> JsonObject:
        return await _call_async(
            lambda: list_versions_async(
                client=self._generated,
                limit=limit,
                cursor=_optional(cursor),
                status=_status(status),
                policy_key=_optional(policy_key),
            )
        )

    def get_version(self, version_id: str) -> JsonObject:
        return _call(lambda: get_version(_uuid(version_id), client=self._generated))

    async def get_version_async(self, version_id: str) -> JsonObject:
        return await _call_async(lambda: get_version_async(_uuid(version_id), client=self._generated))

    def approve_version(self, version_id: str) -> JsonObject:
        return _call(
            lambda: approve_version(
                _uuid(version_id), client=self._generated, body=ApproveVersionBody()
            )
        )

    async def approve_version_async(self, version_id: str) -> JsonObject:
        return await _call_async(
            lambda: approve_version_async(
                _uuid(version_id), client=self._generated, body=ApproveVersionBody()
            )
        )

    def reject_version(self, version_id: str, *, reason: str) -> JsonObject:
        return _call(
            lambda: reject_version(
                _uuid(version_id), client=self._generated, body=RejectVersionBody(reason=reason)
            )
        )

    async def reject_version_async(self, version_id: str, *, reason: str) -> JsonObject:
        return await _call_async(
            lambda: reject_version_async(
                _uuid(version_id), client=self._generated, body=RejectVersionBody(reason=reason)
            )
        )

    def get_diff(self, diff_id: str) -> JsonObject:
        return _call(lambda: get_diff(_uuid(diff_id), client=self._generated))

    async def get_diff_async(self, diff_id: str) -> JsonObject:
        return await _call_async(lambda: get_diff_async(_uuid(diff_id), client=self._generated))


def _base_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme not in ("http", "https") or parsed.netloc == "":
        raise AnumatError("base_url must be an http(s) URL", code="validation_failed")
    return base_url.rstrip("/")


def _api_key(api_key: str) -> str:
    if api_key.strip() == "":
        raise AnumatError("api_key must be a non-empty string", code="validation_failed")
    return api_key


def _uuid(value: object) -> UUID:
    if not isinstance(value, str):
        raise AnumatError("id must be a UUID", code="validation_failed")
    try:
        return UUID(value)
    except ValueError as error:
        raise AnumatError("id must be a UUID", code="validation_failed") from error


def _optional(value: str | None) -> str | Unset:
    return UNSET if value is None else value


def _payer_body(name: str, slug: str, market: str) -> CreatePayerBody:
    try:
        parsed = CreatePayerBodyMarket(market)
    except ValueError as error:
        raise AnumatError("market must be us", code="validation_failed") from error
    return CreatePayerBody(name=name, slug=slug, market=parsed)


def _source_body(
    payer_id: str,
    title: str,
    source_url: str,
    policy_slug: str | None,
    market: str | None,
    adapter_type: str | None,
    check_interval_hours: int | None,
    enabled: bool | None,
) -> CreateSourceBody:
    parsed_market: CreateSourceBodyMarket | Unset = UNSET
    if market is not None:
        try:
            parsed_market = CreateSourceBodyMarket(market)
        except ValueError as error:
            raise AnumatError("market must be us", code="validation_failed") from error
    parsed_adapter: Literal["http_pdf"] | Unset = UNSET
    if adapter_type is not None:
        if adapter_type != "http_pdf":
            raise AnumatError("adapter_type must be http_pdf", code="validation_failed")
        parsed_adapter = "http_pdf"
    return CreateSourceBody(
        payer_id=_uuid(payer_id),
        title=title,
        source_url=source_url,
        policy_slug=_optional(policy_slug),
        market=parsed_market,
        adapter_type=parsed_adapter,
        check_interval_hours=UNSET if check_interval_hours is None else check_interval_hours,
        enabled=UNSET if enabled is None else enabled,
    )


def _status(status: str | None) -> ListVersionsStatus | Unset:
    if status is None:
        return UNSET
    try:
        return ListVersionsStatus(status)
    except ValueError as error:
        raise AnumatError("status must be a version status", code="validation_failed") from error


def _call(run: Callable[[], Any]) -> JsonObject:
    try:
        return _body(run())
    except httpx.TransportError as error:
        raise AnumatError(str(error), code="network_error") from error


async def _call_async(run: Callable[[], Awaitable[Any]]) -> JsonObject:
    try:
        return _body(await run())
    except httpx.TransportError as error:
        raise AnumatError(str(error), code="network_error") from error


def _body(response: Any) -> JsonObject:
    status = int(response.status_code)
    parsed = response.parsed
    if status >= 400 or parsed is None or not hasattr(parsed, "to_dict"):
        message, code = _error_message_and_code(response, status)
        raise AnumatError(message, status=status, code=code)
    body = parsed.to_dict()
    if not isinstance(body, dict):
        raise AnumatError("expected a JSON object", status=status)
    return body


def _error_message_and_code(response: Any, status: int) -> tuple[str, str | None]:
    payloads: list[Any] = []
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        payloads.append(parsed)
        to_dict = getattr(parsed, "to_dict", None)
        if callable(to_dict):
            try:
                payloads.append(to_dict())
            except Exception:
                pass
    content = getattr(response, "content", b"")
    if isinstance(content, bytes) and content:
        try:
            payloads.append(json.loads(content.decode()))
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
    elif isinstance(content, str) and content:
        try:
            payloads.append(json.loads(content))
        except json.JSONDecodeError:
            pass
    for payload in payloads:
        message, code = _read_error(payload)
        if message is not None or code is not None:
            text = message if isinstance(message, str) and message != "" else f"Anumat returned HTTP {status}"
            return text, code
    return f"Anumat returned HTTP {status}", None


def _read_error(payload: Any) -> tuple[str | None, str | None]:
    if isinstance(payload, dict):
        nested = payload.get("error")
        if isinstance(nested, dict):
            json_body = nested.get("json")
            if isinstance(json_body, dict):
                return _read_error(json_body)
            return _string_field(nested, "message"), _code_field(nested)
        return _string_field(payload, "message"), _code_field(payload)
    message = getattr(payload, "message", None)
    code = getattr(payload, "code", None)
    data = getattr(payload, "data", None)
    if isinstance(message, str) or isinstance(code, str) or isinstance(data, dict):
        return message if isinstance(message, str) else None, _code_field({"code": code, "data": data})
    return None, None


def _string_field(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) else None


def _code_field(payload: dict[str, Any]) -> str | None:
    code = payload.get("code")
    if isinstance(code, str) and code != "":
        return code
    data = payload.get("data")
    if isinstance(data, dict):
        nested = data.get("code")
        if isinstance(nested, str) and nested != "":
            return nested
    return None
