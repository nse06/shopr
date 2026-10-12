from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

USER_AGENT = "Mozilla/5.0 (compatible; shopr-prototype/0.1; personal use)"

# Rough conversion for price filtering across store currencies. Good enough for a
# "max $150" filter; not for display (we show the native price).
USD_PER_UNIT = {
    "USD": 1.0, "CAD": 0.73, "AUD": 0.66, "NZD": 0.6, "GBP": 1.33, "EUR": 1.16, "CHF": 1.25,
    "SEK": 0.105, "DKK": 0.156, "NOK": 0.098, "JPY": 0.0067, "KRW": 0.00073, "HKD": 0.128,
}


def to_usd(price: float | None, currency: str | None) -> float | None:
    if price is None:
        return None
    rate = USD_PER_UNIT.get((currency or "USD").upper())
    return price * rate if rate else None


@dataclass
class SearchResult:
    """Listings from one query, in the marketplace's own order (used as the baseline)."""

    query: str
    listings: list[dict[str, Any]] = field(default_factory=list)


class SourceError(Exception):
    pass


_SIZE_TAG = re.compile(r"(?:^|[|:_\s])size(?: adults)?[|:\s]+([a-z0-9][a-z0-9 ./-]{0,10})$", re.I)
_SIZE_IN_TITLE = re.compile(
    r"(?:\bsz\.?|\bsize)\s*[:\-]?\s*(?P<a>[0-9]{1,2}(?:\.5)?(?:\s*x\s*[0-9]{2})?|xxs|xs|s|m|l|xl|xxl|xxxl|[0-9]xl)\b"
    r"|\s[-|]\s*(?P<b>xxs|xs|s|m|l|xl|xxl|xxxl|[0-9]xl)\b"
    r"|\bw(?P<c>[0-9]{2})\b",  # jeans: W32 x L30 -> waist 32
    re.I,
)


def guess_sizes(title: str, tags: list[str]) -> list[str]:
    """Search results don't include variants, so read the size from tags
    ("Size|L", "size:M") or the title ("... - L", "SZ M", "Size 32")."""
    sizes: list[str] = []
    for tag in tags:
        m = _SIZE_TAG.search(tag.strip())
        if m:
            sizes.append(m.group(1).strip().upper())
    m = _SIZE_IN_TITLE.search(title)
    if m:
        sizes.append((m.group("a") or m.group("b") or m.group("c")).strip().upper())
    return list(dict.fromkeys(sizes))
