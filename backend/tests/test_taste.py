import numpy as np

from shopr.embedder import FakeEmbedder
from shopr.taste import (
    build_profile,
    cluster_board,
    dedupe_near,
    diversify,
    keyword_rank,
    passes_filters,
    queries_from_tags,
    round_robin,
    team_draft_interleave,
)


def _unit(x):
    return x / np.linalg.norm(x, axis=-1, keepdims=True)


def _blobs(seed=0, per=6, k=3, dim=32, noise=0.05):
    rng = np.random.default_rng(seed)
    centers = _unit(rng.standard_normal((k, dim)))
    pts = np.concatenate([_unit(c + noise * rng.standard_normal((per, dim))) for c in centers])
    return pts.astype(np.float32), centers


def test_cluster_board_finds_distinct_directions():
    x, _ = _blobs()
    labels, centers = cluster_board(x)
    assert len(centers) == 3
    # Each true group lands in a single cluster.
    for g in range(3):
        assert len(set(labels[g * 6 : (g + 1) * 6])) == 1


def test_cluster_board_small_board_is_one_cluster():
    x, _ = _blobs(per=1, k=4)
    labels, centers = cluster_board(x)
    assert len(centers) == 1 and set(labels) == {0}


def test_cluster_board_tight_board_stays_one_cluster():
    x, _ = _blobs(per=12, k=1, noise=0.2)
    _, centers = cluster_board(x)
    assert len(centers) == 1


def test_profile_scores_nearby_items_higher():
    x, centers = _blobs()
    prof = build_profile(_Text32(), list(range(len(x))), x)
    near = _unit(centers[0] + 0.01)
    far = _unit(-centers.sum(axis=0))
    scores, best = prof.score(np.array([near, far], dtype=np.float32))
    assert scores[0] > scores[1]


class _Text32(FakeEmbedder):
    dim = 32


def test_feedback_moves_scores():
    x, centers = _blobs()
    prof = build_profile(_Text32(), list(range(len(x))), x)
    item = _unit(centers[1] + 0.3)
    before, _ = prof.score(item[None])
    prof.noped = item[None].astype(np.float32)
    after, _ = prof.score(item[None])
    assert after[0] < before[0]


def test_queries_from_tags():
    qs = queries_from_tags({"garment": ["chore coat", "work pants"], "material": ["duck canvas"], "style": ["vintage workwear"], "color": ["brown"]})
    assert qs[0] == "brown duck canvas chore coat"
    assert "vintage workwear chore coat" in qs
    assert len(qs) == len(set(qs))


def test_filters():
    prefs = {"exclude_terms": ["replica"], "min_price": 20, "max_price": 200, "size_terms": ["M"]}
    assert passes_filters({"title": "Chore coat", "sizes": ["M"]}, prefs, 100)
    assert not passes_filters({"title": "Replica chore coat", "sizes": ["M"]}, prefs, 100)
    assert not passes_filters({"title": "Chore coat", "sizes": ["M"]}, prefs, 500)
    assert not passes_filters({"title": "Chore coat", "sizes": ["XL"]}, prefs, 100)
    assert passes_filters({"title": "Chore coat", "sizes": ["M / 38"]}, prefs, 100)
    # Unknown size and unknown price are kept.
    assert passes_filters({"title": "Chore coat", "sizes": []}, prefs, None)
    # "m" must not match inside another word.
    assert not passes_filters({"title": "x", "sizes": ["Medium-weight XL"]}, prefs, 100)


def test_filters_use_size_groups():
    prefs = {"sizes_tops": ["M"], "sizes_waist": ["32"], "sizes_shoes": ["10.5"]}
    assert passes_filters({"title": "Chore coat", "sizes": ["M"]}, prefs, None)
    assert passes_filters({"title": "501s", "sizes": ["32"]}, prefs, None)
    assert passes_filters({"title": "Boots", "sizes": ["10.5"]}, prefs, None)
    assert not passes_filters({"title": "Chore coat", "sizes": ["XL"]}, prefs, None)


def test_keyword_rank():
    texts = ["Vintage Carhartt chore coat", "Levi's 501 jeans", "Canvas chore jacket"]
    assert set(keyword_rank(texts, "canvas chore coat")) == {0, 2}
    # Generic words don't count, and one stray word isn't a match for a longer query.
    assert keyword_rank(["Vintage floral dress"], "vintage canvas chore coat") == []
    assert keyword_rank(["Chore coat"], "vintage chore") == [0]


def test_team_draft_interleave_is_balanced_and_unique():
    ours = [f"a{i}" for i in range(10)]
    base = [f"b{i}" for i in range(10)]
    out = team_draft_interleave(ours, base, 10, seed=1)
    teams = [t for _, t in out]
    assert teams.count("ours") == 5 and teams.count("baseline") == 5
    ids = [i for i, _ in out]
    assert len(ids) == len(set(ids))
    # Shared items are only shown once.
    out = team_draft_interleave(["x", "y"], ["x", "z"], 10, seed=2)
    assert sorted(i for i, _ in out) == ["x", "y", "z"]


def test_team_draft_with_empty_baseline():
    out = team_draft_interleave(["a", "b"], [], 5)
    assert out == [("a", "ours"), ("b", "ours")]


def test_diversify_gives_each_cluster_slots():
    ids = ["a1", "a2", "a3", "b1"]
    scores = {"a1": 0.9, "a2": 0.8, "a3": 0.7, "b1": 0.1}
    cluster = {"a1": 0, "a2": 0, "a3": 0, "b1": 1}
    out = diversify(ids, scores, cluster, [3, 2])
    assert out.index("b1") < 3


def test_dedupe_near():
    v = _unit(np.ones(4, dtype=np.float32))
    w = _unit(np.array([1, 0, 0, 0], dtype=np.float32))
    assert dedupe_near(["a", "b", "c"], {"a": v, "b": v.copy(), "c": w}) == ["a", "c"]


def test_round_robin():
    assert round_robin([["a", "b"], ["c"], ["a", "d"]]) == ["a", "c", "d", "b"]
