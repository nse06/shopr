"""Etsy Open API v3. Etsy has a lot of real vintage (it must be 20+ years old to
be listed as vintage). Create an app at https://www.etsy.com/developers/your-apps
and set ETSY_KEYSTRING / ETSY_SHARED_SECRET. Public listing search only needs the
API key header, no OAuth."""

from __future__ import annotations

from typing import Any

import httpx

from ..config import Settings
from .base import SearchResult, SourceError

API = "https://openapi.etsy.com/v3/application"


class EtsyClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient):
        self.http = http
        self.headers = {"x-api-key": f"{settings.etsy_keystring}:{settings.etsy_shared_secret}"}

    async def search(self, query: str, limit: int = 50) -> SearchResult:
        r = await self.http.get(
            f"{API}/listings/active",
            headers=self.headers,
            params={"keywords": f"{query} mens", "limit": min(limit, 100), "sort_on": "score"},
        )
        if r.status_code != 200:
            raise SourceError(f"Etsy search '{query}': HTTP {r.status_code} {r.text[:200]}")
        results = r.json().get("results") or []
        if not results:
            return SearchResult(query, [])
        # The search endpoint doesn't return images; fetch them in one batch call.
        ids = [str(x["listing_id"]) for x in results]
        r = await self.http.get(
            f"{API}/listings/batch",
            headers=self.headers,
            params={"listing_ids": ",".join(ids), "includes": "Images"},
        )
        if r.status_code != 200:
            raise SourceError(f"Etsy listing batch: HTTP {r.status_code} {r.text[:200]}")
        by_id = {x["listing_id"]: x for x in r.json().get("results") or []}
        # Keep Etsy's search order: it is the baseline we compare against.
        return SearchResult(query, parse_listings([by_id.get(x["listing_id"], x) for x in results]))


def parse_listings(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for x in results:
        images = sorted(x.get("images") or [], key=lambda im: im.get("rank") or 0)
        if not images:
            continue
        price = x.get("price") or {}
        value = None
        if price.get("amount") is not None and price.get("divisor"):
            value = price["amount"] / price["divisor"]
        out.append({
            "id": f"etsy:{x['listing_id']}",
            "source": "etsy",
            "title": x.get("title") or "",
            "price": value,
            "currency": price.get("currency_code"),
            "url": x.get("url") or f"https://www.etsy.com/listing/{x['listing_id']}",
            "image_url": images[0].get("url_570xN"),
            "description": (x.get("description") or "")[:2000],
            "sizes": [],
            "extra": {"when_made": x.get("when_made"), "tags": x.get("tags"), "materials": x.get("materials")},
        })
    return out
