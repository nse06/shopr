"""Runtime configuration, read from environment variables (and an optional .env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader so we don't need python-dotenv. Existing env vars win."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


BACKEND_DIR = Path(__file__).resolve().parent.parent
_load_dotenv(BACKEND_DIR / ".env")


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("SHOPR_DATA_DIR", BACKEND_DIR / "data")))
    # "siglip" = Marqo FashionSigLIP (real); "fake" = deterministic hash embedder for tests/dev.
    embedder: str = field(default_factory=lambda: os.environ.get("SHOPR_EMBEDDER", "siglip"))
    web_dir: Path = field(default_factory=lambda: Path(os.environ.get("SHOPR_WEB_DIR", BACKEND_DIR.parent / "app" / "dist")))

    ebay_client_id: str = field(default_factory=lambda: os.environ.get("EBAY_CLIENT_ID", ""))
    ebay_client_secret: str = field(default_factory=lambda: os.environ.get("EBAY_CLIENT_SECRET", ""))
    ebay_marketplace: str = field(default_factory=lambda: os.environ.get("EBAY_MARKETPLACE", "EBAY_US"))
    # Men's Clothing, Men's Shoes, Men's Accessories.
    ebay_category_ids: str = field(default_factory=lambda: os.environ.get("EBAY_CATEGORY_IDS", "1059,93427,4250"))
    # eBay Partner Network campaign id; when set, eBay returns affiliate links.
    ebay_campaign_id: str = field(default_factory=lambda: os.environ.get("EBAY_CAMPAIGN_ID", ""))

    etsy_keystring: str = field(default_factory=lambda: os.environ.get("ETSY_KEYSTRING", ""))
    etsy_shared_secret: str = field(default_factory=lambda: os.environ.get("ETSY_SHARED_SECRET", ""))

    anthropic_model: str = field(default_factory=lambda: os.environ.get("SHOPR_CLAUDE_MODEL", "claude-opus-5-5"))

    @property
    def ebay_enabled(self) -> bool:
        return bool(self.ebay_client_id and self.ebay_client_secret)

    @property
    def etsy_enabled(self) -> bool:
        return bool(self.etsy_keystring and self.etsy_shared_secret)

    @property
    def claude_enabled(self) -> bool:
        return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "shopr.db"


settings = Settings()
