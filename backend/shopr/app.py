"""HTTP API for the app, plus the static web build."""

from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import keys, pinboard
from .config import Settings, settings as default_settings
from .db import DB, from_blob
from .embedder import make_embedder
from .engine import Engine
from .ingest import IngestError, decode_image, fetch_url_media, is_video, save_image, video_frames
from .sources.shopify import normalize_domain


def _aspect_of(path: Path) -> float:
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.height / im.width
    except Exception:
        return 1.25


class UrlIn(BaseModel):
    url: str


class ListingRef(BaseModel):
    listing_id: str


class StoreIn(BaseModel):
    domain: str
    name: str | None = None


class KeysIn(BaseModel):
    ebay_client_id: str | None = None
    ebay_client_secret: str | None = None
    etsy_keystring: str | None = None
    etsy_shared_secret: str | None = None
    anthropic_api_key: str | None = None


class BoardPatch(BaseModel):
    x: float | None = None
    y: float | None = None
    w: float | None = None
    rot: float | None = None
    z: int | None = None


class StorePatch(BaseModel):
    enabled: bool


def create_app(settings: Settings | None = None, embedder_factory=None) -> FastAPI:
    s = settings or default_settings
    db = DB(s.db_path)
    keys.load_saved(s, db)
    engine = Engine(s, db, embedder_factory or (lambda: make_embedder(s.embedder)))
    token = os.environ.get("SHOPR_TOKEN", "")
    background: set[asyncio.Task] = set()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Load the model in the background so the server answers immediately.
        task = asyncio.create_task(engine.load_embedder())
        background.add(task)
        yield

    app = FastAPI(title="shopr", lifespan=lifespan)
    app.state.engine = engine
    app.state.db = db
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def require_token(request: Request, call_next):
        # Optional shared secret, for when the server is exposed through a tunnel.
        path = request.url.path
        if token and (path.startswith("/api") or path.startswith("/media")) and request.method != "OPTIONS":
            supplied = request.headers.get("x-shopr-token") or request.query_params.get("token")
            if supplied != token:
                return JSONResponse({"detail": "Missing or wrong access token"}, status_code=401)
        return await call_next(request)

    # ------------------------------------------------------------------ status

    @app.get("/api/status")
    async def status() -> dict[str, Any]:
        counts = db.query(
            "SELECT (SELECT COUNT(*) FROM board_items) AS board, (SELECT COUNT(*) FROM listings) AS listings, "
            "(SELECT COUNT(*) FROM listings WHERE embedding IS NOT NULL) AS analyzed, "
            "(SELECT COUNT(*) FROM feed) AS feed, (SELECT COUNT(*) FROM shopify_stores WHERE enabled = 1) AS stores"
        )[0]
        return {
            "embedder": engine.embedder_status,
            "sources": _sources(),
            "counts": dict(counts),
            "latest_run": _latest_run(),
            "auth_required": bool(token),
        }

    # ------------------------------------------------------------------ board

    def _ensure_layout() -> None:
        """Give photos from before the pinboard a size and a spot."""
        rows = db.board_items()
        placed = [dict(r) for r in rows if r["x"] is not None and r["aspect"] is not None]
        for r in rows:
            if r["aspect"] is None or r["x"] is None:
                aspect = r["aspect"] or _aspect_of(s.media_dir / r["path"])
                spot = pinboard.place(placed, aspect, seed=r["id"])
                db.update_board_item(r["id"], {"aspect": aspect, **spot})
                placed.append({**spot, "aspect": aspect})
            if r["z"] is None:
                db.update_board_item(r["id"], {"z": r["id"]})

    def _board_json() -> list[dict[str, Any]]:
        _ensure_layout()
        return [
            {
                "id": r["id"], "kind": r["kind"], "image": f"/media/{r['path']}", "origin": r["origin"],
                "group": r["group_key"], "aspect": r["aspect"], "x": r["x"], "y": r["y"], "w": r["w"],
                "rot": r["rot"], "z": r["z"],
            }
            for r in db.board_items()
        ]

    def _new_spot(aspect: float, seed: int) -> dict[str, float]:
        placed = [dict(r) for r in db.board_items() if r["x"] is not None and r["aspect"] is not None]
        return pinboard.place(placed, aspect, seed)

    @app.get("/api/board")
    async def board() -> list[dict[str, Any]]:
        return _board_json()

    async def _add_media(data: bytes, filename: str | None, content_type: str | None, origin: str | None, kind: str) -> list[int]:
        emb = await engine.embedder()
        if is_video(filename, content_type):
            frames = await asyncio.to_thread(video_frames, data, Path(filename or "x.mp4").suffix)
            vecs = await asyncio.to_thread(emb.embed_images, frames)
            group = f"video-{time.time_ns()}"
            ids, kept = [], []
            for img, v in zip(frames, vecs):
                if kept and float(np.max(np.array(kept) @ v)) > 0.93:
                    continue  # same shot; one frame is enough
                kept.append(v)
                aspect = img.height / img.width
                ids.append(db.add_board_item(
                    "video_frame", save_image(img, s.media_dir), origin, v, group,
                    aspect=aspect, spot=_new_spot(aspect, time.time_ns()),
                ))
            return ids
        img = await asyncio.to_thread(decode_image, data)
        vec = (await asyncio.to_thread(emb.embed_images, [img]))[0]
        aspect = img.height / img.width
        return [db.add_board_item(kind, save_image(img, s.media_dir), origin, vec, aspect=aspect, spot=_new_spot(aspect, time.time_ns()))]

    @app.post("/api/board/upload")
    async def upload(files: list[UploadFile] = File(...)) -> dict[str, Any]:
        added, errors = [], []
        for f in files:
            try:
                added += await _add_media(await f.read(), f.filename, f.content_type, f.filename, "upload")
            except IngestError as e:
                errors.append(f"{f.filename}: {e}")
        return {"added": added, "errors": errors, "board": _board_json()}

    @app.post("/api/board/url")
    async def add_url(body: UrlIn) -> dict[str, Any]:
        try:
            data, ctype, name = await fetch_url_media(body.url.strip())
            added = await _add_media(data, name, ctype, body.url.strip(), "url")
        except IngestError as e:
            raise HTTPException(400, str(e)) from e
        return {"added": added, "board": _board_json()}

    @app.patch("/api/board/{item_id}")
    async def move_board_item(item_id: int, body: BoardPatch) -> dict[str, Any]:
        """Save where a photo was dragged, how big it is, its tilt and stacking."""
        if not db.query("SELECT 1 FROM board_items WHERE id = ?", (item_id,)):
            raise HTTPException(404, "No such photo on the board")
        db.update_board_item(item_id, pinboard.clamp_patch(body.model_dump()))
        return {"ok": True}

    @app.post("/api/board/arrange")
    async def arrange_board() -> dict[str, Any]:
        """Tidy up: lay all photos out again in neat columns."""
        _ensure_layout()
        items = [{"id": r["id"], "aspect": r["aspect"]} for r in db.board_items()]
        for item_id, spot in pinboard.arrange(items).items():
            db.update_board_item(item_id, spot)
        return {"board": _board_json()}

    @app.delete("/api/board/{item_id}")
    async def delete_board_item(item_id: int) -> dict[str, Any]:
        rows = db.query("SELECT path FROM board_items WHERE id = ?", (item_id,))
        if rows:
            db.execute("DELETE FROM board_items WHERE id = ?", (item_id,))
            (s.media_dir / rows[0]["path"]).unlink(missing_ok=True)
        return {"board": _board_json()}

    @app.get("/media/{name}")
    async def media(name: str):
        path = (s.media_dir / name).resolve()
        if path.parent != s.media_dir.resolve() or not path.is_file():
            raise HTTPException(404)
        return FileResponse(path)

    # ------------------------------------------------------------------ profile + refresh

    @app.get("/api/profile")
    async def profile() -> dict[str, Any]:
        prof = await engine.profile()
        if prof is None:
            return {"clusters": []}
        rows = {r["id"]: r for r in db.board_items()}
        out = []
        for c in prof.clusters:
            members = sorted(c.member_ids, key=lambda i: -float(from_blob(rows[i]["embedding"]) @ c.centroid))
            out.append({**c.to_json(), "images": [f"/media/{rows[i]['path']}" for i in members[:6]]})
        return {"clusters": out}

    def _latest_run() -> dict[str, Any] | None:
        rows = db.query("SELECT * FROM runs ORDER BY id DESC LIMIT 1")
        if not rows:
            return None
        r = rows[0]
        return {"id": r["id"], "status": r["status"], "started": r["started"], "finished": r["finished"], "detail": json.loads(r["detail"] or "{}")}

    @app.post("/api/refresh")
    async def refresh(force: bool = False) -> dict[str, Any]:
        if engine.refresh_lock.locked():
            return {"started": False, "run": _latest_run()}
        if not db.board_items():
            raise HTTPException(400, "Add some images to your moodboard first.")
        cur = db.execute("INSERT INTO runs(started, status, detail) VALUES(?, 'running', '{}')", (time.time(),))
        task = asyncio.create_task(engine.refresh(int(cur.lastrowid), force_stores=force))
        background.add(task)
        task.add_done_callback(background.discard)
        return {"started": True, "run": _latest_run()}

    @app.get("/api/runs/latest")
    async def latest_run() -> dict[str, Any] | None:
        return _latest_run()

    # ------------------------------------------------------------------ feed + feedback

    def _listing_json(r) -> dict[str, Any]:
        extra = json.loads(r["extra"] or "{}")
        return {
            "id": r["id"],
            "source": r["source"].split(":")[0],
            "store": r["source"].split(":", 1)[1] if r["source"].startswith("shopify:") else r["source"],
            "title": r["title"],
            "price": r["price"],
            "currency": r["currency"],
            "url": r["url"],
            "image": r["image_url"],
            "sizes": json.loads(r["sizes"] or "[]"),
            "brand": extra.get("vendor"),
            "condition": extra.get("condition"),
            "era": extra.get("when_made"),
        }

    @app.get("/api/feed")
    async def feed(offset: int = 0, limit: int = 30) -> dict[str, Any]:
        hidden = "SELECT listing_id FROM feedback WHERE action = 'nope'"
        rows = db.query(
            "SELECT f.position, f.score, f.cluster, l.*, "
            "EXISTS(SELECT 1 FROM feedback s WHERE s.listing_id = l.id AND s.action = 'like') AS saved "
            f"FROM feed f JOIN listings l ON l.id = f.listing_id WHERE f.listing_id NOT IN ({hidden}) "
            "ORDER BY f.position LIMIT ? OFFSET ?",
            (limit, offset),
        )
        total = db.query(f"SELECT COUNT(*) AS n FROM feed WHERE listing_id NOT IN ({hidden})")[0]["n"]
        # Which ranking each item came from is deliberately not returned: the test is blind.
        items = [{**_listing_json(r), "score": r["score"], "cluster": r["cluster"], "saved": bool(r["saved"])} for r in rows]
        return {"items": items, "total": total}

    def _record(listing_id: str, kind: str) -> None:
        arm = db.query("SELECT arm FROM feed WHERE listing_id = ?", (listing_id,))
        db.execute(
            "INSERT INTO events(listing_id, kind, arm, created_at) VALUES(?,?,?,?)",
            (listing_id, kind, arm[0]["arm"] if arm else None, time.time()),
        )

    @app.post("/api/opened")
    async def opened(body: ListingRef) -> dict[str, Any]:
        _record(body.listing_id, "open")
        return {"ok": True}

    @app.post("/api/saved")
    async def save(body: ListingRef) -> dict[str, Any]:
        db.execute(
            "INSERT INTO feedback(listing_id, action, arm, created_at) VALUES(?, 'like', NULL, ?) "
            "ON CONFLICT(listing_id) DO UPDATE SET action = 'like', created_at = excluded.created_at",
            (body.listing_id, time.time()),
        )
        _record(body.listing_id, "save")
        return {"ok": True}

    @app.delete("/api/saved/{listing_id:path}")
    async def unsave(listing_id: str) -> dict[str, Any]:
        db.execute("DELETE FROM feedback WHERE listing_id = ? AND action = 'like'", (listing_id,))
        _record(listing_id, "unsave")
        return {"ok": True}

    @app.get("/api/saved")
    async def saved() -> list[dict[str, Any]]:
        rows = db.query(
            "SELECT l.* FROM feedback f JOIN listings l ON l.id = f.listing_id WHERE f.action = 'like' ORDER BY f.created_at DESC"
        )
        return [{**_listing_json(r), "saved": True} for r in rows]

    @app.get("/api/stats")
    async def stats() -> dict[str, Any]:
        """Blind test results: how many listings from each ranking you opened or saved.
        Team-draft interleaving shows both rankings equally, so whichever gets more
        opens and saves is the one that finds better listings for you."""
        rows = db.query(
            "SELECT arm, kind, COUNT(DISTINCT listing_id) AS n FROM events "
            "WHERE arm IS NOT NULL AND kind IN ('open', 'save') GROUP BY arm, kind"
        )
        out = {arm: {"opens": 0, "saves": 0} for arm in ("ours", "baseline")}
        for r in rows:
            out.setdefault(r["arm"], {"opens": 0, "saves": 0})["opens" if r["kind"] == "open" else "saves"] = r["n"]
        return out

    # ------------------------------------------------------------------ prefs + stores

    # ------------------------------------------------------------------ API keys

    def _sources() -> dict[str, bool]:
        return {"shopify": True, "ebay": s.ebay_enabled, "etsy": s.etsy_enabled, "claude": s.claude_enabled}

    @app.put("/api/keys")
    async def save_keys(body: KeysIn) -> dict[str, Any]:
        values = {k: v.strip() for k, v in body.model_dump().items() if v and v.strip()}
        try:
            if "ebay_client_id" in values or "ebay_client_secret" in values:
                cid = values.get("ebay_client_id") or s.ebay_client_id
                secret = values.get("ebay_client_secret") or s.ebay_client_secret
                if not (cid and secret):
                    raise keys.KeyCheckFailed("Enter both the eBay App ID and the Cert ID.")
                await keys.check_ebay(s, cid, secret)
            if "etsy_keystring" in values or "etsy_shared_secret" in values:
                ks = values.get("etsy_keystring") or s.etsy_keystring
                secret = values.get("etsy_shared_secret") or s.etsy_shared_secret
                if not (ks and secret):
                    raise keys.KeyCheckFailed("Enter both the Etsy keystring and the shared secret.")
                await keys.check_etsy(ks, secret)
            if "anthropic_api_key" in values:
                await keys.check_claude(values["anthropic_api_key"])
        except keys.KeyCheckFailed as e:
            raise HTTPException(400, str(e)) from e
        keys.save(s, db, values)
        return {"sources": _sources()}

    @app.delete("/api/keys/{source}")
    async def forget_keys(source: str) -> dict[str, Any]:
        if source not in keys.SOURCES:
            raise HTTPException(404, "Unknown source")
        keys.forget(s, db, source)
        return {"sources": _sources()}

    @app.get("/api/prefs")
    async def get_prefs() -> dict[str, Any]:
        return db.prefs()

    @app.put("/api/prefs")
    async def put_prefs(body: dict[str, Any]) -> dict[str, Any]:
        prefs = db.set_prefs(body)
        if not engine.refresh_lock.locked():
            await engine.rank()
        return prefs

    @app.get("/api/stores")
    async def stores() -> list[dict[str, Any]]:
        rows = db.query(
            "SELECT s.*, (SELECT COUNT(*) FROM listings l WHERE l.source = 'shopify:' || s.domain AND l.last_seen > 0) AS listings "
            "FROM shopify_stores s ORDER BY s.domain"
        )
        return [{"domain": r["domain"], "name": r["name"], "enabled": bool(r["enabled"]), "last_fetched": r["last_fetched"], "listings": r["listings"]} for r in rows]

    @app.post("/api/stores")
    async def add_store(body: StoreIn) -> dict[str, Any]:
        domain = normalize_domain(body.domain)
        if "." not in domain:
            raise HTTPException(400, "Enter a store domain like example.com")
        db.execute("INSERT OR IGNORE INTO shopify_stores(domain, name) VALUES(?, ?)", (domain, body.name))
        return {"ok": True, "domain": domain}

    @app.patch("/api/stores/{domain}")
    async def patch_store(domain: str, body: StorePatch) -> dict[str, Any]:
        db.execute("UPDATE shopify_stores SET enabled = ? WHERE domain = ?", (int(body.enabled), domain))
        return {"ok": True}

    @app.delete("/api/stores/{domain}")
    async def delete_store(domain: str) -> dict[str, Any]:
        db.execute("DELETE FROM shopify_stores WHERE domain = ?", (domain,))
        db.execute("UPDATE listings SET last_seen = 0 WHERE source = ?", (f"shopify:{domain}",))
        return {"ok": True}

    # ------------------------------------------------------------------ web app

    if s.web_dir.is_dir():
        app.mount("/_expo", StaticFiles(directory=s.web_dir / "_expo", check_dir=False), name="expo")

        @app.get("/{path:path}", include_in_schema=False)
        async def web(path: str):
            if path.startswith(("api/", "media/")):
                raise HTTPException(404)
            candidate = (s.web_dir / path).resolve()
            if path and candidate.is_file() and s.web_dir.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(s.web_dir / "index.html")

    else:

        @app.get("/", include_in_schema=False)
        async def no_web_build():
            return HTMLResponse(
                "<p style='font-family:sans-serif'>The shopr server is running, but the website isn't built yet. "
                "Run <code>make web</code> (or <code>cd app &amp;&amp; npx expo export --platform web</code>) "
                "and reload. The phone app works without it.</p>"
            )

    return app

