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
    return {
        "id": pid, "title": f"Vintage {color_name} jacket {pid}", "handle": f"p{pid}", "body_html": "",
        "tags": [color_name], "options": [{"name": "Size", "position": 1}],
        "variants": [{"price": "50", "available": True, "option1": "M"}],
        "images": [{"src": f"https://cdn.example/{color_name}/{pid}.png"}],
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


@respx.mock(assert_all_mocked=True, assert_all_called=False)
def test_full_flow(client, respx_mock):
    respx_mock.route(host="testserver").pass_through()
    products = [_product(i, "brown") for i in range(10)] + [_product(100 + i, "blue") for i in range(10)]
    respx_mock.get("https://shop.example/cart.js").mock(return_value=httpx.Response(200, json={"currency": "USD"}))
    respx_mock.get("https://shop.example/products.json").mock(return_value=httpx.Response(200, json={"products": products}))
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

    feed = client.get("/api/feed?limit=50").json()
    assert feed["items"], feed
    assert "arm" not in feed["items"][0]  # blind
    # The taste ranking puts brown items ahead of blue ones among items it drafted.
    stats_before = client.get("/api/stats").json()
    assert stats_before["ours"]["rated"] == 0

    # With the blind test off, the feed is pure taste ranking: browns first.
    client.put("/api/prefs", json={"blind_test": False})
    items = client.get("/api/feed?limit=20").json()["items"]
    first_blue = next(i for i, x in enumerate(items) if "blue" in x["title"])
    assert first_blue >= 10, [x["title"] for x in items]

    # Feedback is recorded and removes the item from the feed.
    target = items[0]["id"]
    client.post("/api/feedback", json={"listing_id": target, "action": "like"})
    assert target not in [x["id"] for x in client.get("/api/feed?limit=50").json()["items"]]
    assert client.get("/api/likes").json()[0]["id"] == target
    assert client.get("/api/stats").json()["ours"]["like"] == 1

    # Undo puts it back.
    client.delete(f"/api/feedback/{target}")
    assert client.get("/api/likes").json() == []

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
