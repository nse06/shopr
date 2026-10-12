"""Layout for the moodboard pinboard.

Positions are in board units: the board is BOARD_WIDTH units wide and the app
scales it to the screen. Each photo sits in a polaroid-style frame (FRAME_*),
gets a slight tilt, and new photos are dropped into the shortest column so the
board grows like a collage. People can then drag and resize freely."""

from __future__ import annotations

import random
from typing import Any

BOARD_WIDTH = 1000.0
COLUMNS = 4
FRAME_SIDE = 8.0     # frame border around the photo (the app draws the same)
FRAME_BOTTOM = 26.0  # the wider polaroid bottom edge
GAP = 18.0
MIN_W, MAX_W = 110.0, 700.0


def frame_height(w: float, aspect: float) -> float:
    """Height of a framed photo `w` units wide; aspect is the photo's height / width."""
    return (w - 2 * FRAME_SIDE) * aspect + FRAME_SIDE + FRAME_BOTTOM


def _column_bottoms(placed: list[dict[str, Any]]) -> list[float]:
    col_w = BOARD_WIDTH / COLUMNS
    bottoms = [GAP] * COLUMNS
    for it in placed:
        col = min(COLUMNS - 1, max(0, int((it["x"] + it["w"] / 2) // col_w)))
        bottoms[col] = max(bottoms[col], it["y"] + frame_height(it["w"], it["aspect"]) + GAP)
    return bottoms


def place(placed: list[dict[str, Any]], aspect: float, seed: int) -> dict[str, float]:
    """Spot for a new photo: the top of the shortest column, with a little jitter."""
    rng = random.Random(seed)
    col_w = BOARD_WIDTH / COLUMNS
    w = rng.uniform(195, 232)
    bottoms = _column_bottoms(placed)
    col = min(range(COLUMNS), key=lambda c: bottoms[c])
    return {
        "x": round(col * col_w + (col_w - w) / 2 + rng.uniform(-10, 10), 1),
        "y": round(bottoms[col] + rng.uniform(0, 12), 1),
        "w": round(w, 1),
        "rot": round(rng.uniform(-4, 4), 1),
    }


def arrange(items: list[dict[str, Any]]) -> dict[int, dict[str, float]]:
    """Tidy up: lay everything out again in order. Returns {id: x/y/w/rot}."""
    placed: list[dict[str, Any]] = []
    out: dict[int, dict[str, float]] = {}
    for it in items:
        spot = place(placed, it["aspect"], seed=it["id"])
        out[it["id"]] = spot
        placed.append({**spot, "aspect": it["aspect"]})
    return out


def clamp_patch(patch: dict[str, Any]) -> dict[str, float]:
    """Keep dragged/resized values sane."""
    out: dict[str, float] = {}
    if patch.get("w") is not None:
        out["w"] = min(MAX_W, max(MIN_W, float(patch["w"])))
    if patch.get("x") is not None:
        out["x"] = min(BOARD_WIDTH - 40, max(-200.0, float(patch["x"])))
    if patch.get("y") is not None:
        out["y"] = max(0.0, float(patch["y"]))
    if patch.get("rot") is not None:
        out["rot"] = min(45.0, max(-45.0, float(patch["rot"])))
    if patch.get("z") is not None:
        out["z"] = int(patch["z"])
    return out
