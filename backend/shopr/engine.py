"""The refresh pipeline: moodboard -> taste profile -> queries -> listings ->
embeddings -> ranked feed (optionally interleaved with a keyword baseline)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from .config import Settings
from .db import DB, from_blob
from .embedder import Embedder, load_image
from .sources import shopify
from .sources.base import USER_AGENT, SearchResult, SourceError, to_usd
from .sources.ebay import EbayClient
from .sources.etsy import EtsyClient
from .tagger import claude_queries
from .taste import (
    TasteProfile,
    build_profile,
    dedupe_near,
    diversify,
    keyword_rank,
    passes_filters,
    round_robin,
    team_draft_interleave,
)

log = logging.getLogger(__name__)

STORE_TTL = 6 * 3600          # re-pull a Shopify catalog at most every 6 hours
FEED_SIZE = 150
MAX_QUERIES = 12              # marketplace queries per refresh, across clusters
MAX_IMAGE_SEARCHES = 8        # eBay image searches per refresh
# Photos analyzed per refresh. On a laptop CPU the model does roughly 10-30 photos/s
# (much faster on Apple Silicon/GPU); the rest are picked up on later refreshes.
EMBED_BUDGET = int(os.environ.get("SHOPR_EMBED_BUDGET", "2500"))
DEFAULT_STORES = Path(__file__).with_name("stores.json")


class Engine:
    def __init__(self, settings: Settings, db: DB, embedder_factory):
        self.s = settings
        self.db = db
        self._embedder_factory = embedder_factory
        self._embedder: Embedder | None = None
        self._embedder_error: str | None = None
        self._embedder_ready = asyncio.Event()
        self.refresh_lock = asyncio.Lock()
        self._profile_cache: tuple[str, TasteProfile] | None = None
        self._seed_stores()

    # ------------------------------------------------------------------ embedder

    async def load_embedder(self) -> None:
        try:
            self._embedder = await asyncio.to_thread(self._embedder_factory)
        except Exception as e:  # surface model download/import problems in /api/status
            log.exception("Failed to load embedder")
            self._embedder_error = f"{type(e).__name__}: {e}"
        finally:
            self._embedder_ready.set()

    async def embedder(self) -> Embedder:
        await self._embedder_ready.wait()
        if self._embedder is None:
            raise RuntimeError(f"Image model failed to load: {self._embedder_error}")
        return self._embedder

    @property
    def embedder_status(self) -> str:
        if not self._embedder_ready.is_set():
            return "loading"
        return "ready" if self._embedder else f"error: {self._embedder_error}"

    # ------------------------------------------------------------------ stores

    def _seed_stores(self) -> None:
        if self.db.get_kv("stores_seeded") or not DEFAULT_STORES.exists():
            return
        stores = json.loads(DEFAULT_STORES.read_text())
        self.db.executemany(
            "INSERT OR IGNORE INTO shopify_stores(domain, name, enabled) VALUES(?, ?, ?)",
            [(s["domain"], s.get("name"), int(s.get("enabled", True))) for s in stores],
        )
        self.db.set_kv("stores_seeded", True)

    # ------------------------------------------------------------------ profile

    def _feedback_vectors(self, action: str) -> np.ndarray | None:
        rows = self.db.query(
            "SELECT l.embedding FROM feedback f JOIN listings l ON l.id = f.listing_id "
            "WHERE f.action = ? AND l.embedding IS NOT NULL",
            (action,),
        )
        return np.array([from_blob(r["embedding"]) for r in rows]) if rows else None

    async def profile(self) -> TasteProfile | None:
        rows = self.db.board_items()
        if not rows:
            return None
        key = hashlib.sha1(",".join(str(r["id"]) for r in rows).encode()).hexdigest()
        if self._profile_cache and self._profile_cache[0] == key:
            prof = self._profile_cache[1]
        else:
            emb = await self.embedder()
            board = np.array([from_blob(r["embedding"]) for r in rows])
            prof = await asyncio.to_thread(build_profile, emb, [r["id"] for r in rows], board)
            self._apply_cached_claude(key, prof)
            self._profile_cache = (key, prof)
        prof.liked = self._feedback_vectors("like")
        prof.noped = self._feedback_vectors("nope")
        return prof

    def _apply_cached_claude(self, key: str, prof: TasteProfile) -> None:
        cached = self.db.get_kv("claude_queries", {}) or {}
        if cached.get("key") != key:
            return
        for c in prof.clusters:
            entry = cached["clusters"].get(str(c.index))
            if entry:
                c.queries, c.summary = entry["queries"], entry["summary"]
                c.tags["avoid"] = entry.get("avoid_terms", [])

    async def _maybe_claude(self, prof: TasteProfile, logline) -> None:
        """Ask Claude to write queries once per distinct moodboard (cached)."""
        if not self.s.claude_enabled or any(c.summary for c in prof.clusters):
            return
        rows = {r["id"]: r for r in self.db.board_items()}
        images: dict[int, list[str]] = {}
        for c in prof.clusters:
            members = sorted(c.member_ids, key=lambda i: -float(from_blob(rows[i]["embedding"]) @ c.centroid))
            images[c.index] = [str(self.s.media_dir / rows[i]["path"]) for i in members[:4]]
        try:
            result = await asyncio.to_thread(claude_queries, self.s.anthropic_model, prof.clusters, images)
        except Exception as e:
            logline(f"Claude query writing failed, using automatic tags instead ({type(e).__name__}: {e})")
            return
        for c in prof.clusters:
            entry = result.get(c.index)
            if entry and entry.get("queries"):
                c.queries = [q for q in entry["queries"] if q.strip()][:6]
                c.summary = entry.get("summary", "")
                c.tags["avoid"] = entry.get("avoid_terms", [])
        key = self._profile_cache[0] if self._profile_cache else ""
        self.db.set_kv("claude_queries", {
            "key": key,
            "clusters": {str(c.index): {"queries": c.queries, "summary": c.summary, "avoid_terms": c.tags.get("avoid", [])} for c in prof.clusters},
        })
        logline("Claude wrote search queries for each taste cluster")

    # ------------------------------------------------------------------ refresh

    async def refresh(self, run_id: int, force_stores: bool = False) -> None:
        detail: dict[str, Any] = {"log": [], "errors": []}

        def logline(msg: str) -> None:
            detail["log"].append(f"{time.strftime('%H:%M:%S')} {msg}")
            self.db.execute("UPDATE runs SET detail = ? WHERE id = ?", (json.dumps(detail), run_id))

        try:
            async with self.refresh_lock:
                await self._refresh(detail, logline, force_stores)
            self.db.execute("UPDATE runs SET status = 'done', finished = ?, detail = ? WHERE id = ?", (time.time(), json.dumps(detail), run_id))
        except Exception as e:
            log.exception("refresh failed")
            detail["errors"].append(f"{type(e).__name__}: {e}")
            self.db.execute("UPDATE runs SET status = 'error', finished = ?, detail = ? WHERE id = ?", (time.time(), json.dumps(detail), run_id))

    async def _refresh(self, detail: dict[str, Any], logline, force_stores: bool) -> None:
        logline("Loading image model")
        await self.embedder()
        prof = await self.profile()
        if prof is None:
            raise RuntimeError("Add some images to your moodboard first.")
        logline(f"Moodboard: {len(prof.board)} images in {len(prof.clusters)} taste cluster(s)")
        await self._maybe_claude(prof, logline)
        detail["clusters"] = [c.to_json() for c in prof.clusters]

        # Spread the query budget across clusters, biggest cluster first.
        queries: list[tuple[int, str]] = []
        per_cluster = [list(c.queries) for c in prof.clusters]
        while len(queries) < MAX_QUERIES and any(per_cluster):
            for ci, qs in enumerate(per_cluster):
                if qs and len(queries) < MAX_QUERIES:
                    queries.append((ci, qs.pop(0)))
        detail["queries"] = [q for _, q in queries]

        baseline_lists: list[list[str]] = []
        async with httpx.AsyncClient(timeout=30, headers={"User-Agent": USER_AGENT}, follow_redirects=True) as http:
            await self._fetch_shopify(http, logline, detail, force_stores)
            if self.s.ebay_enabled:
                baseline_lists += await self._fetch_ebay(http, prof, queries, logline, detail)
            if self.s.etsy_enabled:
                baseline_lists += await self._fetch_etsy(http, queries, logline, detail)
            baseline_lists += self._shopify_baseline([q for _, q in queries])
            self.db.set_kv("baseline_lists", baseline_lists)
            # Baseline items get analyzed first too, so likes on them also teach the ranking.
            priority = {i for lst in baseline_lists for i in lst}
            await self._embed_pending(http, logline, prof, [q for _, q in queries], priority)

        n = await self.rank(prof)
        logline(f"Feed ready: {n} listings")

    def _shopify_baseline(self, queries: list[str]) -> list[list[str]]:
        """Shopify has no search API, so the baseline is keyword matching that mimics
        each shop's search box (newest first among equal matches), then alternates
        between shops the way you would if you searched each one in turn."""
        by_store: dict[str, list] = {}
        for r in sorted(self._fresh_listings(), key=lambda r: -r["first_seen"]):
            if r["source"].startswith("shopify:"):
                by_store.setdefault(r["source"], []).append(r)
        lists = []
        for q in queries:
            per_store = []
            for rows in by_store.values():
                texts = [f"{r['title']} {' '.join(json.loads(r['extra'] or '{}').get('tags') or [])}" for r in rows]
                per_store.append([rows[i]["id"] for i in keyword_rank(texts, q)[:20]])
            lists.append(round_robin(per_store)[:60])
        return lists

    def _fresh_listings(self) -> list:
        max_age = float(self.db.prefs().get("max_age_days") or 3) * 86400
        return self.db.query("SELECT * FROM listings WHERE last_seen >= ?", (time.time() - max_age,))

    async def _fetch_shopify(self, http: httpx.AsyncClient, logline, detail, force: bool) -> None:
        stores = self.db.query("SELECT * FROM shopify_stores WHERE enabled = 1")
        due = [s for s in stores if force or not s["last_fetched"] or time.time() - s["last_fetched"] > STORE_TTL]
        if not due:
            logline(f"Shopify: {len(stores)} store catalogs are fresh, skipping fetch")
            return
        logline(f"Shopify: fetching {len(due)} store catalog(s)")
        sem = asyncio.Semaphore(6)

        async def one(domain: str) -> None:
            async with sem:
                try:
                    listings, _ = await shopify.fetch_store(http, domain)
                except SourceError as e:
                    detail["errors"].append(str(e))
                    return
            self.db.upsert_listings(listings)
            # Anything from this store we didn't see again has sold or been removed.
            ids = [x["id"] for x in listings]
            self.db.execute(
                f"UPDATE listings SET last_seen = 0 WHERE source = ? AND id NOT IN ({','.join('?' * len(ids)) or 'NULL'})",
                [f"shopify:{domain}", *ids],
            )
            self.db.execute("UPDATE shopify_stores SET last_fetched = ? WHERE domain = ?", (time.time(), domain))

        await asyncio.gather(*(one(s["domain"]) for s in due))
        logline("Shopify: done")

    async def _fetch_ebay(self, http, prof: TasteProfile, queries, logline, detail) -> list[list[str]]:
        client = EbayClient(self.s, http)
        baseline: list[list[str]] = []
        results: list[SearchResult] = []
        for _, q in queries:
            try:
                results.append(await client.search(q))
            except SourceError as e:
                detail["errors"].append(str(e))
        for res in results:
            self.db.upsert_listings(res.listings)
            baseline.append([x["id"] for x in res.listings])
        logline(f"eBay: {sum(len(r.listings) for r in results)} results from {len(results)} keyword searches")

        # Image search: the board images closest to each cluster centre, round-robin.
        rows = {r["id"]: r for r in self.db.board_items()}
        picks = round_robin([
            [str(i) for i in sorted(c.member_ids, key=lambda i: -float(from_blob(rows[i]["embedding"]) @ c.centroid))]
            for c in prof.clusters
        ])[:MAX_IMAGE_SEARCHES]
        found = 0
        for pid in picks:
            path = self.s.media_dir / rows[int(pid)]["path"]
            try:
                res = await client.search_by_image(path.read_bytes(), label=f"board image {pid}")
            except SourceError as e:
                detail["errors"].append(str(e))
                continue
            self.db.upsert_listings(res.listings)
            found += len(res.listings)
        if picks:
            logline(f"eBay: {found} results from {len(picks)} image searches")
        return baseline

    async def _fetch_etsy(self, http, queries, logline, detail) -> list[list[str]]:
        client = EtsyClient(self.s, http)
        baseline: list[list[str]] = []
        total = 0
        for _, q in queries:
            try:
                res = await client.search(q)
            except SourceError as e:
                detail["errors"].append(str(e))
                continue
            self.db.upsert_listings(res.listings)
            baseline.append([x["id"] for x in res.listings])
            total += len(res.listings)
        logline(f"Etsy: {total} results from {len(baseline)} searches")
        return baseline

    async def _embed_pending(
        self, http: httpx.AsyncClient, logline, prof: TasteProfile, queries: list[str], priority: set[str]
    ) -> None:
        fresh = {r["id"]: r for r in self._fresh_listings()}
        pending = self.db.listings_needing_embedding(list(fresh))
        if not pending:
            return
        if len(pending) > EMBED_BUDGET:
            # Analyze the likeliest matches first: marketplace search results (already
            # targeted), then shop items whose text mentions the board's tags/queries.
            words = {w for q in queries for w in q.lower().split() if len(w) > 2}
            words |= {t.lower() for c in prof.clusters for cat in ("garment", "material", "style") for t in c.tags.get(cat, [])}

            def rank_key(row) -> tuple[int, int, int, float]:
                r = fresh[row["id"]]
                marketplace = 0 if r["source"].startswith("shopify:") else 1
                text = f"{r['title']} {r['extra']}".lower()
                hits = sum(1 for w in words if re.search(rf"\b{re.escape(w)}\b", text))
                return (int(row["id"] in priority), marketplace, hits, r["first_seen"])

            total = len(pending)
            pending = sorted(pending, key=rank_key, reverse=True)[:EMBED_BUDGET]
            logline(f"Analyzing {len(pending)} of {total} new listing photos (the rest on later refreshes)")
        else:
            logline(f"Analyzing {len(pending)} new listing photos")
        emb = await self.embedder()
        sem = asyncio.Semaphore(16)

        async def download(row) -> tuple[str, Any]:
            async with sem:
                try:
                    r = await http.get(row["image_url"])
                    if r.status_code != 200:
                        return row["id"], None
                    return row["id"], await asyncio.to_thread(load_image, r.content)
                except Exception:
                    return row["id"], None

        done = 0
        for i in range(0, len(pending), 64):
            batch = await asyncio.gather(*(download(r) for r in pending[i : i + 64]))
            ok = [(lid, img) for lid, img in batch if img is not None]
            for lid, img in batch:
                if img is None:
                    self.db.set_listing_embedding(lid, None)
            if ok:
                vecs = await asyncio.to_thread(emb.embed_images, [img for _, img in ok])
                for (lid, _), v in zip(ok, vecs):
                    self.db.set_listing_embedding(lid, v)
            done += len(batch)
            if done % 256 == 0 or done == len(pending):
                # Refresh the feed as photos come in, so matches show up within a minute
                # or two instead of after the whole batch.
                if done < len(pending):
                    await self.rank(prof)
                logline(f"Analyzed {done}/{len(pending)} photos")

    # ------------------------------------------------------------------ ranking

    async def rank(self, prof: TasteProfile | None = None) -> int:
        """Rebuild the feed from stored listings (no network). Cheap; also run after
        new likes/nopes so feedback takes effect without a full refresh."""
        prof = prof or await self.profile()
        if prof is None:
            return 0
        prefs = self.db.prefs()
        rated = {r["listing_id"] for r in self.db.query("SELECT listing_id FROM feedback")}
        rows = [r for r in self._fresh_listings() if r["id"] not in rated]

        def keep(r, cluster: int | None = None) -> bool:
            listing = {"title": r["title"], "sizes": json.loads(r["sizes"] or "[]")}
            if not passes_filters(listing, prefs, to_usd(r["price"], r["currency"])):
                return False
            if cluster is not None and cluster < len(prof.clusters):
                title = r["title"].lower()
                if any(t and t.lower() in title for t in prof.clusters[cluster].tags.get("avoid", [])):
                    return False
            return True

        with_vec = [r for r in rows if r["embedding"] is not None]
        vecs = {r["id"]: from_blob(r["embedding"]) for r in with_vec}
        if with_vec:
            x = np.array([vecs[r["id"]] for r in with_vec])
            scores, best = prof.score(x)
        else:
            scores, best = np.zeros(0), np.zeros(0, dtype=int)
        score_of = {r["id"]: float(s) for r, s in zip(with_vec, scores)}
        cluster_of = {r["id"]: int(b) for r, b in zip(with_vec, best)}
        candidates = [r["id"] for r in with_vec if keep(r, cluster_of[r["id"]])]
        # Only the top slice matters; diversify that, then drop near-duplicate photos.
        top = sorted(candidates, key=lambda i: -score_of[i])[: FEED_SIZE * 4]
        ours = dedupe_near(diversify(top, score_of, cluster_of, [len(c.member_ids) for c in prof.clusters]), vecs)[:FEED_SIZE]

        if prefs.get("blind_test"):
            by_id = {r["id"]: r for r in rows}
            baseline = [
                i for i in round_robin(self.db.get_kv("baseline_lists", []) or [])
                if i in by_id and keep(by_id[i])
            ]
            feed = team_draft_interleave(ours, baseline, FEED_SIZE)
        else:
            feed = [(i, "ours") for i in ours]

        self.db.execute("DELETE FROM feed")
        self.db.executemany(
            "INSERT INTO feed(position, listing_id, score, arm, cluster) VALUES(?,?,?,?,?)",
            [(pos, lid, score_of.get(lid), arm, cluster_of.get(lid)) for pos, (lid, arm) in enumerate(feed)],
        )
        return len(feed)
