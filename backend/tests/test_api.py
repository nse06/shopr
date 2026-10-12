"""End-to-end through the HTTP API with a fake embedder and a mocked Shopify store."""

import io
import time

import httpx
import numpy as np
import pytest
import respx
from fastapi.testclient import TestClient
from PIL import Image

from shopr.app import create_app
from shopr.config import Settings
from shopr.embedder import FakeEmbedder


def _png(color, seed=0) -> bytes:
    """A solid colour with per-block noise, so items of one colour are similar but not identical."""
    rng = np.random.default_rng(seed)
    img = np.clip(np.array(color) + rng.integers(-40, 40, size=(4, 4, 3)), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img).resize((64, 64), Image.NEAREST).save(buf, format="PNG")
    return buf.getvalue()


BROWNS = [(120 + i, 70, 30) for i in range(0, 30, 5)]
BLUES = [(20, 40, 150 + i) for i in range(0, 30, 5)]


def _product(pid, color_name):
    """A product as the full catalog (/products.json) lists it."""
    return {
        "id": pid, "title": f"Vintage {color_name} jacket {pid}", "handle": f"p{pid}", "body_html": "",
        "tags": [color_name], "options": [{"name": "Size", "position": 1}],
        "variants": [{"price": "50", "available": True, "option1": "M"}],
        "images": [{"src": f"https://cdn.example/{color_name}/{pid}.png"}],
    }


def _suggested(pid, color_name):
    """The same product as the shop's search box (/search/suggest.json) returns it."""
    return {
        "id": pid, "title": f"Vintage {color_name} jacket {pid} - M", "handle": f"p{pid}", "available": True,
        "price": "50.00", "tags": [color_name], "type": "Jacket", "vendor": "Shop",
        "image": f"https://cdn.example/{color_name}/{pid}.png",
    }


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("SHOPR_TOKEN", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    settings = Settings(data_dir=tmp_path, embedder="fake", web_dir=tmp_path / "noweb",
                        ebay_client_id="", ebay_client_secret="", etsy_keystring="", etsy_shared_secret="")
    app = create_app(settings, embedder_factory=FakeEmbedder)
    with TestClient(app) as c:
        # Replace the seeded store list with one mocked store.
        app.state.db.execute("DELETE FROM shopify_stores")
        c.post("/api/stores", json={"domain": "https://shop.example/"})
        yield c


def _wait_for_run(client, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get("/api/runs/latest").json()
        if run and run["status"] != "running":
            return run
        time.sleep(0.1)
    raise AssertionError("refresh did not finish")


@pytest.mark.parametrize("mode", ["search", "deep_scan"])
@respx.mock(assert_all_mocked=True, assert_all_called=False)
def test_full_flow(client, respx_mock, mode):
    respx_mock.route(host="testserver").pass_through()
    ids = [(i, "brown") for i in range(10)] + [(100 + i, "blue") for i in range(10)]
    respx_mock.get("https://shop.example/cart.js").mock(return_value=httpx.Response(200, json={"currency": "USD"}))
    catalog = respx_mock.get("https://shop.example/products.json").mock(
        return_value=httpx.Response(200, json={"products": [_product(*x) for x in ids]})
    )
    search = respx_mock.get("https://shop.example/search/suggest.json").mock(
        return_value=httpx.Response(200, json={"resources": {"results": {"products": [_suggested(*x) for x in ids]}}})
    )
    if mode == "deep_scan":
        client.put("/api/prefs", json={"deep_scan": True})
    for i in range(10):
        respx_mock.get(f"https://cdn.example/brown/{i}.png").mock(return_value=httpx.Response(200, content=_png((130, 72, 32), seed=i)))
        respx_mock.get(f"https://cdn.example/blue/{100 + i}.png").mock(return_value=httpx.Response(200, content=_png((20, 40, 170), seed=100 + i)))

    # Refresh without a board is refused.
    assert client.post("/api/refresh").status_code == 400

    # Moodboard: all browns.
    files = [("files", (f"b{i}.png", _png(c, seed=1000 + i), "image/png")) for i, c in enumerate(BROWNS)]
    r = client.post("/api/board/upload", files=files)
    assert r.status_code == 200 and len(r.json()["board"]) == len(BROWNS)

    prof = client.get("/api/profile").json()
    assert prof["clusters"] and prof["clusters"][0]["queries"]

    assert client.post("/api/refresh").json()["started"]
    run = _wait_for_run(client)
    assert run["status"] == "done", run
    # Search mode only asks the shop's search box; deep scan pulls the catalog.
    assert (search.called, catalog.called) == ((True, False) if mode == "search" else (False, True))

    feed = client.get("/api/feed?limit=50").json()
    assert feed["items"], feed
    assert "arm" not in feed["items"][0]  # blind
    # The taste ranking puts brown items ahead of blue ones among items it drafted.
    assert client.get("/api/stats").json()["ours"] == {"opens": 0, "saves": 0}

    # With the blind test off, the feed is pure taste ranking: browns first.
    client.put("/api/prefs", json={"blind_test": False})
    items = client.get("/api/feed?limit=20").json()["items"]
    first_blue = next(i for i, x in enumerate(items) if "blue" in x["title"])
    assert first_blue >= 10, [x["title"] for x in items]

    # Saving keeps the item in the grid (marked saved) and lists it under Saved.
    target = items[0]["id"]
    client.post("/api/saved", json={"listing_id": target})
    grid = client.get("/api/feed?limit=50").json()["items"]
    assert next(x for x in grid if x["id"] == target)["saved"] is True
    assert client.get("/api/saved").json()[0]["id"] == target
    # Opens and saves are credited to the ranking that showed the item.
    client.post("/api/opened", json={"listing_id": target})
    client.post("/api/opened", json={"listing_id": target})  # counted once
    assert client.get("/api/stats").json()["ours"] == {"opens": 1, "saves": 1}

    client.delete(f"/api/saved/{target}")
    assert client.get("/api/saved").json() == []
    assert target in [x["id"] for x in client.get("/api/feed?limit=50").json()["items"]]

    # Price filter applies on re-rank.
    client.put("/api/prefs", json={"max_price": 10})
    assert client.get("/api/feed").json()["items"] == []


def test_store_management(client):
    assert [s["domain"] for s in client.get("/api/stores").json()] == ["shop.example"]
    client.patch("/api/stores/shop.example", json={"enabled": False})
    assert client.get("/api/stores").json()[0]["enabled"] is False
    client.delete("/api/stores/shop.example")
    assert client.get("/api/stores").json() == []
    assert client.post("/api/stores", json={"domain": "nonsense"}).status_code == 400


def test_board_delete_and_bad_upload(client):
    r = client.post("/api/board/upload", files=[("files", ("x.png", _png((1, 2, 3)), "image/png")),
                                                 ("files", ("bad.png", b"not an image", "image/png"))])
    body = r.json()
    assert len(body["added"]) == 1 and len(body["errors"]) == 1
    item = body["board"][0]
    assert client.get(item["image"]).status_code == 200
    assert client.delete(f"/api/board/{item['id']}").json()["board"] == []


def test_root_explains_missing_web_build(client):
    r = client.get("/")
    assert r.status_code == 200 and "make web" in r.text


def test_token_required(tmp_path, monkeypatch):
    monkeypatch.setenv("SHOPR_TOKEN", "sekret")
    app = create_app(Settings(data_dir=tmp_path, embedder="fake", web_dir=tmp_path / "noweb"), embedder_factory=FakeEmbedder)
    with TestClient(app) as c:
        assert c.get("/api/status").status_code == 401
        assert c.get("/api/status", headers={"x-shopr-token": "sekret"}).status_code == 200
        assert c.get("/api/status?token=sekret").status_code == 200


@respx.mock(assert_all_mocked=True, assert_all_called=False)
def test_keys_are_checked_saved_and_forgotten(client, respx_mock):
    respx_mock.route(host="testserver").pass_through()
    token = respx_mock.post("https://api.ebay.com/identity/v1/oauth2/token")
    token.mock(return_value=httpx.Response(401, json={"error": "invalid_client"}))
    r = client.put("/api/keys", json={"ebay_client_id": "id", "ebay_client_secret": "wrong"})
    assert r.status_code == 400 and "eBay didn't accept" in r.json()["detail"]
    assert client.get("/api/status").json()["sources"]["ebay"] is False

    token.mock(return_value=httpx.Response(200, json={"access_token": "t", "expires_in": 7200}))
    r = client.put("/api/keys", json={"ebay_client_id": " id ", "ebay_client_secret": "secret"})
    assert r.status_code == 200 and r.json()["sources"]["ebay"] is True
    # Saved keys survive a restart, and are never sent back to the app.
    assert client.app.state.db.get_kv("keys")["ebay_client_id"] == "id"
    assert "secret" not in client.get("/api/status").text

    assert client.put("/api/keys", json={"ebay_client_id": "only-half"}).status_code == 200  # secret already saved
    assert client.delete("/api/keys/ebay").json()["sources"]["ebay"] is False
    assert client.put("/api/keys", json={"etsy_keystring": "k"}).status_code == 400  # half a pair


def test_claude_key_check(client, monkeypatch):
    from shopr import keys

    async def reject(api_key):
        raise keys.KeyCheckFailed("Anthropic didn't accept this API key.")

    monkeypatch.setattr(keys, "check_claude", reject)
    r = client.put("/api/keys", json={"anthropic_api_key": "sk-bad"})
    assert r.status_code == 400 and "didn't accept" in r.json()["detail"]

    async def accept(api_key):
        return None

    monkeypatch.setattr(keys, "check_claude", accept)
    assert client.put("/api/keys", json={"anthropic_api_key": "sk-good"}).json()["sources"]["claude"] is True
    client.delete("/api/keys/claude")
    assert client.get("/api/status").json()["sources"]["claude"] is False


def test_prefs_store_only_what_was_set(client):
    client.put("/api/prefs", json={"max_price": 120, "not_a_pref": 1})
    assert client.app.state.db.get_kv("prefs") == {"max_price": 120}
    prefs = client.get("/api/prefs").json()
    assert prefs["max_price"] == 120 and prefs["deep_scan"] is False and "not_a_pref" not in prefs


def test_pinboard_layout_move_and_tidy(client):
    files = [("files", (f"p{i}.png", _png((30 * i, 90, 60), seed=i), "image/png")) for i in range(6)]
    board = client.post("/api/board/upload", files=files).json()["board"]
    assert len(board) == 6
    for item in board:
        assert item["aspect"] == 1.0 and 100 < item["w"] < 300 and -5 <= item["rot"] <= 5
    # New photos fill the columns across before stacking down.
    assert len({round(b["x"] // 250) for b in board[:4]}) == 4
    assert board[-1]["z"] > board[0]["z"]

    first = board[0]["id"]
    assert client.patch(f"/api/board/{first}", json={"x": 600, "y": 900, "w": 5000, "z": 99}).json()["ok"]
    moved = next(b for b in client.get("/api/board").json() if b["id"] == first)
    assert (moved["x"], moved["y"], moved["w"], moved["z"]) == (600, 900, 700, 99)  # width clamped
    assert client.patch("/api/board/9999", json={"x": 1}).status_code == 404

    tidy = client.post("/api/board/arrange").json()["board"]
    again = next(b for b in tidy if b["id"] == first)
    assert again["y"] < 100 and again["w"] < 300


def test_pinboard_places_photos_from_before_the_pinboard(client):
    client.post("/api/board/upload", files=[("files", ("a.png", _png((10, 20, 30)), "image/png"))])
    db = client.app.state.db
    db.execute("UPDATE board_items SET x = NULL, y = NULL, w = NULL, aspect = NULL, z = NULL")
    item = client.get("/api/board").json()[0]
    assert item["x"] is not None and item["aspect"] == 1.0 and item["z"] is not None
