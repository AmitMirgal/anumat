"""Anumat API client."""

from __future__ import annotations

from typing import Any

from anumat._generated.api.default.payers_list import asyncio as payers_list_async
from anumat._generated.api.default.payers_list import sync as payers_list
from anumat._generated.client import AuthenticatedClient
from anumat._generated.models.payers_list_response_200 import PayersListResponse200
from anumat._generated.types import UNSET


class AnumatClient:
    """Sync and async client for the REST API at `{base_url}/api/v1`."""

    def __init__(self, base_url: str, api_key: str) -> None:
        root = base_url.rstrip("/")
        self._generated = AuthenticatedClient(base_url=f"{root}/api/v1", token=api_key)

    @property
    def generated(self) -> AuthenticatedClient:
        return self._generated

    def list_payers(self, *, limit: int = 20, cursor: str | None = None) -> dict[str, Any]:
        parsed = payers_list(
            client=self._generated,
            limit=limit,
            cursor=cursor if cursor is not None else UNSET,
        )
        return _page(parsed)

    async def list_payers_async(self, *, limit: int = 20, cursor: str | None = None) -> dict[str, Any]:
        parsed = await payers_list_async(
            client=self._generated,
            limit=limit,
            cursor=cursor if cursor is not None else UNSET,
        )
        return _page(parsed)


def _page(parsed: object) -> dict[str, Any]:
    if not isinstance(parsed, PayersListResponse200):
        raise RuntimeError("Anumat returned an error from GET /payers")
    body = parsed.to_dict()
    if not isinstance(body, dict):
        raise TypeError("expected a JSON object")
    return body
