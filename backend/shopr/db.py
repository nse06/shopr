"""SQLite storage. Embeddings are stored as float32 blobs; at Phase 0 scale (a few
thousand listings) brute-force cosine similarity in numpy is plenty fast."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

import numpy as np

SCHEMA = """
CREATE TABLE IF NOT EXISTS board_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,              -- upload | url | video_frame
    path TEXT NOT NULL,              -- file name inside media dir
    origin TEXT,                     -- original file name or URL
    group_key TEXT,                  -- frames from one video share a key
    created_at REAL NOT NULL,
    embedding BLOB,
    aspect REAL,                     -- photo height / width
    x REAL, y REAL, w REAL,          -- pinboard position and width (board units)
    rot REAL,                        -- tilt in degrees
    z INTEGER                        -- stacking order
);

CREATE TABLE IF NOT EXISTS shopify_stores (
    domain TEXT PRIMARY KEY,
    name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_fetched REAL,
    currency TEXT
);

CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,             -- "<source>:<external id>"
    source TEXT NOT NULL,            -- shopify:<domain> | ebay | etsy
    title TEXT NOT NULL,
    price REAL,
    currency TEXT,
    url TEXT NOT NULL,
    image_url TEXT,
    description TEXT,
    sizes TEXT,                      -- JSON list of available size strings
    extra TEXT,                      -- JSON blob of source-specific fields
    first_seen REAL NOT NULL,
    last_seen REAL NOT NULL,
    embedding BLOB,
    embed_failed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS listings_last_seen ON listings(last_seen);

CREATE TABLE IF NOT EXISTS feed (
    position INTEGER PRIMARY KEY,
    listing_id TEXT NOT NULL,
    score REAL,
    arm TEXT NOT NULL,               -- ours | baseline | both  (blind A/B credit)
    cluster INTEGER,
    run_id INTEGER
);

CREATE TABLE IF NOT EXISTS feedback (
    listing_id TEXT PRIMARY KEY,
    action TEXT NOT NULL,            -- like (saved) | nope (hidden)
    arm TEXT,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL,
    kind TEXT NOT NULL,              -- open | save | unsave
    arm TEXT,                        -- which ranking showed it (blind test credit)
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started REAL NOT NULL,
    finished REAL,
    status TEXT NOT NULL,            -- running | done | error
    detail TEXT                      -- JSON: log lines, clusters, queries, counts
);

CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

DEFAULT_PREFS: dict[str, Any] = {
    "min_price": None,
    "max_price": None,
    "sizes_tops": [],          # e.g. ["M", "L"]
    "sizes_waist": [],         # e.g. ["32"]
    "sizes_shoes": [],         # US sizes, e.g. ["10", "10.5"]
    "size_terms": [],          # any other size words to match
    "onboarded": False,        # sizes and price range have been asked
    "exclude_terms": ["replica", "lot of", "bundle", "costume", "women's", "womens"],
    "blind_test": True,        # interleave a keyword-search baseline to measure the ranking
    "deep_scan": False,        # also pull whole Shopify catalogs (slow; finds what search misses)
}

# Columns added after the first release; created on startup if missing.
MIGRATIONS = {
    "shopify_stores": {"currency": "TEXT"},
    "board_items": {"aspect": "REAL", "x": "REAL", "y": "REAL", "w": "REAL", "rot": "REAL", "z": "INTEGER"},
}


def to_blob(vec: np.ndarray) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def from_blob(blob: bytes | None) -> np.ndarray | None:
    if blob is None:
        return None
    return np.frombuffer(blob, dtype=np.float32)


class DB:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.executescript(SCHEMA)
            for table, columns in MIGRATIONS.items():
                existing = {r["name"] for r in self._conn.execute(f"PRAGMA table_info({table})")}
                for name, decl in columns.items():
                    if name not in existing:
                        self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
            self._conn.commit()

    # -- low level -----------------------------------------------------------
    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            self._conn.commit()
            return cur

    def executemany(self, sql: str, rows: Iterable[Iterable[Any]]) -> None:
        with self._lock:
            self._conn.executemany(sql, [tuple(r) for r in rows])
            self._conn.commit()

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchall()

    # -- key/value -------------------------------------------------------------
    def get_kv(self, key: str, default: Any = None) -> Any:
        rows = self.query("SELECT value FROM kv WHERE key = ?", (key,))
        return json.loads(rows[0]["value"]) if rows else default

    def set_kv(self, key: str, value: Any) -> None:
        self.execute(
            "INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )

    def prefs(self) -> dict[str, Any]:
        stored = self.get_kv("prefs", {}) or {}
        return {**DEFAULT_PREFS, **{k: v for k, v in stored.items() if k in DEFAULT_PREFS}}

    def set_prefs(self, updates: dict[str, Any]) -> dict[str, Any]:
        # Store only what the user set, so later default changes still reach them.
        stored = {k: v for k, v in (self.get_kv("prefs", {}) or {}).items() if k in DEFAULT_PREFS}
        stored.update({k: v for k, v in updates.items() if k in DEFAULT_PREFS})
        self.set_kv("prefs", stored)
        return self.prefs()

    # -- board -----------------------------------------------------------------
    def add_board_item(
        self, kind: str, path: str, origin: str | None, embedding: np.ndarray,
        group_key: str | None = None, aspect: float | None = None, spot: dict[str, float] | None = None,
    ) -> int:
        spot = spot or {}
        z = self.query("SELECT COALESCE(MAX(z), 0) + 1 AS z FROM board_items")[0]["z"]
        cur = self.execute(
            "INSERT INTO board_items(kind, path, origin, group_key, created_at, embedding, aspect, x, y, w, rot, z) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (kind, path, origin, group_key, time.time(), to_blob(embedding), aspect,
             spot.get("x"), spot.get("y"), spot.get("w"), spot.get("rot"), z),
        )
        return int(cur.lastrowid)

    def update_board_item(self, item_id: int, fields: dict[str, float]) -> None:
        if fields:
            cols = ", ".join(f"{k} = ?" for k in fields)
            self.execute(f"UPDATE board_items SET {cols} WHERE id = ?", (*fields.values(), item_id))

    def board_items(self) -> list[sqlite3.Row]:
        return self.query("SELECT * FROM board_items ORDER BY id")

    # -- listings --------------------------------------------------------------
    def upsert_listings(self, listings: list[dict[str, Any]]) -> None:
        now = time.time()
        self.executemany(
            """
            INSERT INTO listings(id, source, title, price, currency, url, image_url, description, sizes, extra, first_seen, last_seen)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, price = excluded.price, currency = excluded.currency,
                url = excluded.url, description = excluded.description, sizes = excluded.sizes,
                extra = excluded.extra, last_seen = excluded.last_seen,
                -- a new photo means the old embedding is stale
                embedding = CASE WHEN listings.image_url IS excluded.image_url THEN listings.embedding ELSE NULL END,
                embed_failed = CASE WHEN listings.image_url IS excluded.image_url THEN listings.embed_failed ELSE 0 END,
                image_url = excluded.image_url
            """,
            [
                (
                    item["id"], item["source"], item["title"], item.get("price"), item.get("currency"),
                    item["url"], item.get("image_url"), item.get("description"),
                    json.dumps(item.get("sizes") or []), json.dumps(item.get("extra") or {}), now, now,
                )
                for item in listings
            ],
        )

    def listings_needing_embedding(self, ids: list[str] | None = None) -> list[sqlite3.Row]:
        sql = "SELECT id, image_url FROM listings WHERE embedding IS NULL AND embed_failed = 0 AND image_url IS NOT NULL"
        if ids is None:
            return self.query(sql)
        # Chunk to stay under SQLite's variable limit.
        out: list[sqlite3.Row] = []
        for i in range(0, len(ids), 500):
            chunk = ids[i : i + 500]
            out += self.query(sql + f" AND id IN ({','.join('?' * len(chunk))})", chunk)
        return out

    def set_listing_embedding(self, listing_id: str, embedding: np.ndarray | None) -> None:
        if embedding is None:
            self.execute("UPDATE listings SET embed_failed = 1 WHERE id = ?", (listing_id,))
        else:
            self.execute("UPDATE listings SET embedding = ? WHERE id = ?", (to_blob(embedding), listing_id))

    def get_listings(self, ids: list[str]) -> dict[str, sqlite3.Row]:
        out: dict[str, sqlite3.Row] = {}
        for i in range(0, len(ids), 500):
            chunk = ids[i : i + 500]
            for row in self.query(f"SELECT * FROM listings WHERE id IN ({','.join('?' * len(chunk))})", chunk):
                out[row["id"]] = row
        return out
