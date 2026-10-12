from __future__ import annotations

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
