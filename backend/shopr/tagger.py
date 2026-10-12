"""Optional: have Claude look at each moodboard cluster and write marketplace search
queries. Falls back to the zero-shot tags in taste.py when no API key is set."""

from __future__ import annotations

import base64
import io
import json
import logging

import anthropic
from PIL import Image

from .taste import Cluster

log = logging.getLogger(__name__)

SYSTEM = """You are a menswear buyer who knows vintage, workwear, Japanese brands, military surplus, \
archive designer pieces and how secondhand sellers title their listings on eBay and Etsy.

You will see groups of moodboard images. Each group is one direction in a person's taste. For each \
group, describe what ties it together and write search queries that would surface items in that \
direction on secondhand marketplaces. Queries should read like what a seller would put in a listing \
title: 2-5 words, concrete garment type plus the details that matter (fabric, era, cut, brand or \
maker if clearly implied). Avoid vague aesthetic words sellers never use ("vibe", "aesthetic", \
"core"). Also list words that would mark a listing as a bad match for this group."""

SCHEMA = {
    "type": "object",
    "properties": {
        "clusters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "summary": {"type": "string", "description": "One sentence on what ties the group together."},
                    "queries": {"type": "array", "items": {"type": "string"}, "description": "4-6 marketplace search queries."},
                    "avoid_terms": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["index", "summary", "queries", "avoid_terms"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["clusters"],
    "additionalProperties": False,
}


def _jpeg_b64(path: str, max_side: int = 768) -> str:
    img = Image.open(path).convert("RGB")
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.standard_b64encode(buf.getvalue()).decode()


def claude_queries(model: str, clusters: list[Cluster], images_by_cluster: dict[int, list[str]]) -> dict[int, dict]:
    """Returns {cluster index: {"summary", "queries", "avoid_terms"}}. Raises on API errors;
    the caller decides how to fall back."""
    content: list[dict] = []
    for c in clusters:
        content.append({
            "type": "text",
            "text": f"Group {c.index} ({len(c.member_ids)} images). Automatic tags, may be wrong: {json.dumps(c.tags)}",
        })
        for path in images_by_cluster.get(c.index, [])[:4]:
            content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": _jpeg_b64(path)}})
    content.append({"type": "text", "text": "Return one entry per group, using the group numbers above as index."})

    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model=model,
        max_tokens=16000,
        system=SYSTEM,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        # If a safety classifier declines, retry server-side on Anthropic's recommended fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise RuntimeError(f"Claude declined the request ({getattr(response.stop_details, 'category', None)})")
    text = next(b.text for b in response.content if b.type == "text")
    data = json.loads(text)
    return {int(c["index"]): c for c in data["clusters"]}
