"""Independent shops on Shopify expose their catalog at /products.json.
Small vintage shops have hundreds to a few thousand products, so we pull the
whole catalog (capped) and let the taste model do the searching."""

from __future__ import annotations

import html
import re
from typing import Any

import httpx

from .base import USER_AGENT, SourceError

MAX_PAGES = 4  # 250 products per page, newest first
_TAGS = re.compile(r"<[^>]+>")


def normalize_domain(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"^https?://", "", value)
    return value.split("/")[0]


def _size_values(product: dict[str, Any]) -> list[str]:
    size_positions = [
        o.get("position") for o in product.get("options") or []
        if (o.get("name") or "").lower() in ("size", "taille", "größe", "sizes", "waist")
    ]
    sizes = []
    for v in product.get("variants") or []:
        if not v.get("available", True):
            continue
        for pos in size_positions:
            val = v.get(f"option{pos}")
            if val and val not in sizes:
                sizes.append(val)
    return sizes


def _image_url(product: dict[str, Any]) -> str | None:
    images = product.get("images") or []
    if not images:
        return None
    src = images[0].get("src")
    if not src:
        return None
    # Ask Shopify's CDN for a small rendition; plenty for embedding and the feed.
    sep = "&" if "?" in src else "?"
    return f"{src}{sep}width=480"


def parse_products(domain: str, products: list[dict[str, Any]], currency: str | None) -> list[dict[str, Any]]:
    out = []
    for p in products:
        variants = p.get("variants") or []
        if variants and not any(v.get("available", True) for v in variants):
            continue  # sold out
        image = _image_url(p)
        if not image:
            continue
        prices = [float(v["price"]) for v in variants if v.get("price") not in (None, "")]
        description = html.unescape(_TAGS.sub(" ", p.get("body_html") or ""))
        out.append({
            "id": f"shopify:{domain}:{p['id']}",
            "source": f"shopify:{domain}",
            "title": p.get("title") or "",
            "price": min(prices) if prices else None,
            "currency": currency,
            "url": f"https://{domain}/products/{p.get('handle')}",
            "image_url": image,
            "description": " ".join(description.split())[:2000],
            "sizes": _size_values(p),
            "extra": {
                "vendor": p.get("vendor"),
                "product_type": p.get("product_type"),
                "tags": p.get("tags") if isinstance(p.get("tags"), list) else [t.strip() for t in (p.get("tags") or "").split(",") if t.strip()],
                "published_at": p.get("published_at"),
            },
        })
    return out


async def fetch_currency(client: httpx.AsyncClient, domain: str) -> str | None:
    try:
        r = await client.get(f"https://{domain}/cart.js")
        if r.status_code == 200:
            return r.json().get("currency")
    except (httpx.HTTPError, ValueError):
        pass
    return None


async def fetch_store(client: httpx.AsyncClient, domain: str) -> tuple[list[dict[str, Any]], str | None]:
    currency = await fetch_currency(client, domain)
    products: list[dict[str, Any]] = []
    for page in range(1, MAX_PAGES + 1):
        try:
            r = await client.get(f"https://{domain}/products.json", params={"limit": 250, "page": page})
        except httpx.HTTPError as e:
            raise SourceError(f"{domain}: {e}") from e
        if r.status_code != 200:
            if page == 1:
                raise SourceError(f"{domain}: HTTP {r.status_code} (not a Shopify store, or it blocks /products.json)")
            break
        try:
            batch = r.json().get("products") or []
        except ValueError as e:
            raise SourceError(f"{domain}: response was not JSON") from e
        products += batch
        if len(batch) < 250:
            break
    return parse_products(domain, products, currency), currency


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=30, headers={"User-Agent": USER_AGENT}, follow_redirects=True)
