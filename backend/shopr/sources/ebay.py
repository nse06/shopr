"""eBay Browse API: keyword search and image search.

Needs a (free) eBay developer account: create a production keyset at
https://developer.ebay.com/my/keys and set EBAY_CLIENT_ID / EBAY_CLIENT_SECRET.
Uses the client-credentials grant, so no user login is involved.
Note: eBay's API license limits how long listing data may be cached; the app
only ranks listings seen in the last few days and refreshes them on each run.
"""

from __future__ import annotations

import base64
import re
import time
from typing import Any

import httpx

from ..config import Settings
from .base import SearchResult, SourceError, guess_sizes

API = "https://api.ebay.com"
SCOPE = "https://api.ebay.com/oauth/api_scope"


class EbayClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient):
        self.s = settings
        self.http = http
        self._token: str | None = None
        self._token_expiry = 0.0

    async def token(self) -> str:
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        basic = base64.b64encode(f"{self.s.ebay_client_id}:{self.s.ebay_client_secret}".encode()).decode()
        r = await self.http.post(
            f"{API}/identity/v1/oauth2/token",
            headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "client_credentials", "scope": SCOPE},
        )
        if r.status_code != 200:
            raise SourceError(f"eBay auth failed: HTTP {r.status_code} {r.text[:200]}")
        body = r.json()
        self._token = body["access_token"]
        self._token_expiry = time.time() + int(body.get("expires_in", 7200))
        return self._token

    async def _headers(self) -> dict[str, str]:
        h = {"Authorization": f"Bearer {await self.token()}", "X-EBAY-C-MARKETPLACE-ID": self.s.ebay_marketplace}
        if self.s.ebay_campaign_id:
            h["X-EBAY-C-ENDUSERCTX"] = f"affiliateCampaignId={self.s.ebay_campaign_id}"
        return h

    async def search(self, query: str, limit: int = 50, min_price: float | None = None, max_price: float | None = None) -> SearchResult:
        params = {"q": query, "limit": limit}
        if f := price_filter(min_price, max_price):
            params["filter"] = f
        r = await self._with_category(
            category_for(query, self.s.ebay_category_ids),
            lambda p, h: self.http.get(f"{API}/buy/browse/v1/item_summary/search", headers=h, params=p),
            params,
        )
        if r.status_code != 200:
            raise SourceError(f"eBay search '{query}': HTTP {r.status_code} {r.text[:200]}")
        return SearchResult(query, parse_items(r.json()))

    async def search_by_image(
        self, image_bytes: bytes, label: str, limit: int = 50, min_price: float | None = None, max_price: float | None = None
    ) -> SearchResult:
        params = {"limit": limit}
        if f := price_filter(min_price, max_price):
            params["filter"] = f
        body = {"image": base64.b64encode(image_bytes).decode()}
        r = await self._with_category(
            category_for("", self.s.ebay_category_ids),
            lambda p, h: self.http.post(
                f"{API}/buy/browse/v1/item_summary/search_by_image",
                headers={**h, "Content-Type": "application/json"},
                params=p,
                json=body,
            ),
            params,
        )
        if r.status_code != 200:
            raise SourceError(f"eBay image search ({label}): HTTP {r.status_code} {r.text[:200]}")
        return SearchResult(f"[image] {label}", parse_items(r.json()))

    async def _with_category(self, category: str | None, send, params: dict) -> httpx.Response:
        """Search within one category (eBay takes only one per request). If eBay rejects
        the category, search again without it rather than lose the whole search."""
        headers = await self._headers()
        if category:
            r = await send({**params, "category_ids": category}, headers)
            if r.status_code != 400:
                return r
        return await send(params, headers)


# Words that mean a search is for shoes or accessories rather than clothing.
_SHOES = re.compile(r"\b(boots?|shoes?|sneakers?|loafers?|derbys?|oxfords|brogues|moccasins?|sandals?|trainers)\b", re.I)
_ACCESSORIES = re.compile(r"\b(belts?|caps?|hats?|beanies?|bags?|scarf|scarves|wallets?|sunglasses|ties?|gloves)\b", re.I)


def category_for(query: str, configured: str) -> str | None:
    """Pick the one eBay category to search: configured is "clothing,shoes,accessories"
    (by default Men's Clothing 1059, Men's Shoes 93427, Men's Accessories 4250)."""
    ids = [c.strip() for c in configured.split(",") if c.strip()]
    if not ids:
        return None
    if len(ids) > 1 and _SHOES.search(query):
        return ids[1]
    if len(ids) > 2 and _ACCESSORIES.search(query):
        return ids[2]
    return ids[0]


def price_filter(min_price: float | None, max_price: float | None) -> str | None:
    """eBay's filter syntax: price:[10..50], price:[10] (10 and up) or price:[..50]."""
    if min_price is None and max_price is None:
        return None
    if max_price is None:
        rng = f"{min_price:g}"
    else:
        rng = f"{'' if min_price is None else f'{min_price:g}'}..{max_price:g}"
    return f"price:[{rng}],priceCurrency:USD"


def _bigger_image(url: str | None) -> str | None:
    # eBay image URLs encode the size as s-l<N>; 500px is plenty.
    return re.sub(r"s-l\d+", "s-l500", url) if url else None


def parse_items(body: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for item in body.get("itemSummaries") or []:
        image = (item.get("image") or {}).get("imageUrl") or next(
            (t.get("imageUrl") for t in item.get("thumbnailImages") or []), None
        )
        price = item.get("price") or item.get("currentBidPrice") or {}
        try:
            value = float(price["value"]) if price.get("value") is not None else None
        except (TypeError, ValueError):
            value = None
        out.append({
            "id": f"ebay:{item['itemId']}",
            "source": "ebay",
            "title": item.get("title") or "",
            "price": value,
            "currency": price.get("currency"),
            "url": item.get("itemAffiliateWebUrl") or item.get("itemWebUrl") or "",
            "image_url": _bigger_image(image),
            "description": item.get("shortDescription") or "",
            "sizes": guess_sizes(item.get("title") or "", []),
            # No seller details are kept: shopr stores public listing info only, never
            # eBay user data (which is what eBay's account-deletion exemption requires).
            "extra": {
                "condition": item.get("condition"),
                "buying_options": item.get("buyingOptions"),
            },
        })
    return [o for o in out if o["url"]]
