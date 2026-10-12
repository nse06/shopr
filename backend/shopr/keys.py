"""API keys entered in the app's Setup screen.

They're stored in the local database and override the .env file, so nobody has
to edit files. Each key is checked against its service before it's saved."""

from __future__ import annotations

import asyncio
import dataclasses
import os

import anthropic
import httpx

from .config import Settings
from .db import DB
from .sources.base import SourceError
from .sources.ebay import EbayClient

# Setup-screen field -> Settings attribute (None: lives in the environment).
FIELDS = {
    "ebay_client_id": "ebay_client_id",
    "ebay_client_secret": "ebay_client_secret",
    "etsy_keystring": "etsy_keystring",
    "etsy_shared_secret": "etsy_shared_secret",
    "anthropic_api_key": None,
}
SOURCES = {
    "ebay": ("ebay_client_id", "ebay_client_secret"),
    "etsy": ("etsy_keystring", "etsy_shared_secret"),
    "claude": ("anthropic_api_key",),
}


class KeyCheckFailed(Exception):
    pass


def _apply(settings: Settings, field: str, value: str) -> None:
    attr = FIELDS[field]
    if attr:
        setattr(settings, attr, value)
    elif value:
        os.environ["ANTHROPIC_API_KEY"] = value
    else:
        os.environ.pop("ANTHROPIC_API_KEY", None)


def load_saved(settings: Settings, db: DB) -> None:
    for field, value in (db.get_kv("keys", {}) or {}).items():
        if field in FIELDS and value:
            _apply(settings, field, value)


def save(settings: Settings, db: DB, values: dict[str, str]) -> None:
    stored = db.get_kv("keys", {}) or {}
    stored.update(values)
    db.set_kv("keys", stored)
    for field, value in values.items():
        _apply(settings, field, value)


def forget(settings: Settings, db: DB, source: str) -> None:
    stored = db.get_kv("keys", {}) or {}
    for field in SOURCES[source]:
        stored.pop(field, None)
        _apply(settings, field, "")
    db.set_kv("keys", stored)


async def check_ebay(settings: Settings, client_id: str, secret: str) -> None:
    trial = dataclasses.replace(settings, ebay_client_id=client_id, ebay_client_secret=secret)
    async with httpx.AsyncClient(timeout=20) as http:
        try:
            await EbayClient(trial, http).token()
        except (SourceError, httpx.HTTPError) as e:
            rejected = "HTTP 401" in str(e) or "HTTP 400" in str(e)
            raise KeyCheckFailed(
                "eBay didn't accept these keys. Check that you copied the Production App ID and Cert ID "
                "(not the Sandbox ones)." if rejected else f"Couldn't check the keys with eBay: {e}"
            ) from e


async def check_etsy(keystring: str, secret: str) -> None:
    async with httpx.AsyncClient(timeout=20) as http:
        try:
            r = await http.get(
                "https://openapi.etsy.com/v3/application/openapi-ping",
                headers={"x-api-key": f"{keystring}:{secret}"},
            )
        except httpx.HTTPError as e:
            raise KeyCheckFailed(f"Couldn't reach Etsy to check the key: {e}") from e
    if r.status_code != 200:
        raise KeyCheckFailed(f"Etsy didn't accept these keys (HTTP {r.status_code}). Check the keystring and shared secret.")


async def check_claude(api_key: str) -> None:
    def ping() -> None:
        anthropic.Anthropic(api_key=api_key, max_retries=0).models.list(limit=1)

    try:
        await asyncio.to_thread(ping)
    except anthropic.AuthenticationError as e:
        raise KeyCheckFailed("Anthropic didn't accept this API key.") from e
    except anthropic.APIConnectionError as e:
        raise KeyCheckFailed("Couldn't reach Anthropic to check the key. Check your internet connection.") from e
    except anthropic.APIStatusError as e:
        raise KeyCheckFailed(f"Anthropic returned an error while checking the key ({e.status_code}).") from e
