import json
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

from shopr import tagger
from shopr.taste import Cluster


class _FakeMessages:
    def __init__(self, response):
        self.response = response
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return self.response


def _client(response):
    messages = _FakeMessages(response)
    client = SimpleNamespace(beta=SimpleNamespace(messages=messages))
    return client, messages


def _response(payload, stop_reason="end_turn"):
    return SimpleNamespace(
        stop_reason=stop_reason,
        stop_details=None,
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=json.dumps(payload))],
    )


@pytest.fixture
def image(tmp_path):
    p = tmp_path / "a.jpg"
    Image.new("RGB", (900, 1200), (120, 70, 30)).save(p)
    return str(p)


def test_claude_queries_builds_request_and_parses(monkeypatch, image):
    payload = {"clusters": [{"index": 0, "summary": "Brown leather", "queries": ["vintage leather car coat"], "avoid_terms": ["faux"]}]}
    client, messages = _client(_response(payload))
    monkeypatch.setattr(tagger.anthropic, "Anthropic", lambda: client)
    clusters = [Cluster(0, np.zeros(4), [1, 2], {"garment": ["leather jacket"]})]

    out = tagger.claude_queries("claude-opus-5-5", clusters, {0: [image]})

    assert out[0]["queries"] == ["vintage leather car coat"]
    kw = messages.kwargs
    assert kw["model"] == "claude-opus-5-5"
    assert kw["output_config"]["format"]["type"] == "json_schema"
    assert kw["fallbacks"] == "default" and kw["betas"] == ["server-side-fallback-2026-07-01"]
    content = kw["messages"][0]["content"]
    assert content[0]["type"] == "text" and content[1]["type"] == "image"
    assert content[1]["source"]["media_type"] == "image/jpeg"


def test_claude_queries_raises_on_refusal(monkeypatch, image):
    client, _ = _client(_response({"clusters": []}, stop_reason="refusal"))
    monkeypatch.setattr(tagger.anthropic, "Anthropic", lambda: client)
    with pytest.raises(RuntimeError):
        tagger.claude_queries("claude-opus-5-5", [Cluster(0, np.zeros(4), [1])], {0: [image]})
