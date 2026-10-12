"""The taste model: cluster the moodboard, tag each cluster, score listings, and
interleave our ranking with a keyword-search baseline for a blind comparison."""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from typing import Iterable

import numpy as np

from .embedder import Embedder
from .vocab import PROMPTS


# --------------------------------------------------------------------------- clustering


def spherical_kmeans(x: np.ndarray, k: int, seed: int = 0, iters: int = 50) -> tuple[np.ndarray, np.ndarray]:
    """k-means on the unit sphere (cosine similarity). Returns (labels, unit centroids)."""
    rng = np.random.default_rng(seed)
    n = len(x)
    # k-means++ style init on cosine distance.
    centers = [x[rng.integers(n)]]
    for _ in range(1, k):
        dist = 1 - np.max(x @ np.array(centers).T, axis=1)
        dist = np.clip(dist, 0, None)
        probs = dist / dist.sum() if dist.sum() > 0 else np.full(n, 1 / n)
        centers.append(x[rng.choice(n, p=probs)])
    c = np.array(centers)
    labels = np.zeros(n, dtype=int)
    for _ in range(iters):
        new_labels = np.argmax(x @ c.T, axis=1)
        for j in range(k):
            members = x[new_labels == j]
            if len(members):
                m = members.mean(axis=0)
                c[j] = m / max(np.linalg.norm(m), 1e-12)
        if np.array_equal(new_labels, labels):
            break
        labels = new_labels
    return labels, c


def silhouette(x: np.ndarray, labels: np.ndarray) -> float:
    k = labels.max() + 1
    if k < 2:
        return -1.0
    dist = 1 - x @ x.T
    scores = []
    for i in range(len(x)):
        same = labels == labels[i]
        if same.sum() <= 1:
            scores.append(0.0)
            continue
        a = dist[i, same].sum() / (same.sum() - 1)
        b = min(dist[i, labels == j].mean() for j in range(k) if j != labels[i] and (labels == j).any())
        scores.append((b - a) / max(a, b, 1e-12))
    return float(np.mean(scores))


def cluster_board(x: np.ndarray, max_k: int = 5) -> tuple[np.ndarray, np.ndarray]:
    """Pick k by silhouette. A moodboard usually holds a few distinct directions
    (say, Japanese denim + 70s leather + workwear); averaging them gives mush."""
    n = len(x)
    if n < 6:
        return np.zeros(n, dtype=int), _unit(x.mean(axis=0, keepdims=True))
    best = (np.zeros(n, dtype=int), _unit(x.mean(axis=0, keepdims=True)))
    # Require a real gain over one cluster: splitting a single blob of noise
    # scores ~0.05-0.12, so anything under 0.15 is treated as one direction.
    best_score = 0.15
    for k in range(2, min(max_k, n // 3) + 1):
        # A few restarts; keep the tightest fit (k-means is sensitive to its init).
        labels, centers = max(
            (spherical_kmeans(x, k, seed=seed) for seed in range(5)),
            key=lambda lc: float(np.sum(np.max(x @ lc[1].T, axis=1))),
        )
        if np.bincount(labels, minlength=k).min() < 2:
            continue
        s = silhouette(x, labels)
        if s > best_score:
            best, best_score = (labels, centers), s
    return best


def _unit(x: np.ndarray) -> np.ndarray:
    return (x / np.maximum(np.linalg.norm(x, axis=-1, keepdims=True), 1e-12)).astype(np.float32)


# --------------------------------------------------------------------------- tagging


@dataclass
class Cluster:
    index: int
    centroid: np.ndarray
    member_ids: list[int]
    tags: dict[str, list[str]] = field(default_factory=dict)
    queries: list[str] = field(default_factory=list)
    summary: str = ""

    def to_json(self) -> dict:
        return {"index": self.index, "member_ids": self.member_ids, "tags": self.tags, "queries": self.queries, "summary": self.summary}


_prompt_cache: dict[int, dict[str, tuple[list[str], np.ndarray]]] = {}


def _prompt_embeddings(embedder: Embedder) -> dict[str, tuple[list[str], np.ndarray]]:
    key = id(embedder)
    if key not in _prompt_cache:
        _prompt_cache[key] = {
            cat: (terms, embedder.embed_texts([template.format(t) for t in terms]))
            for cat, (template, terms) in PROMPTS.items()
        }
    return _prompt_cache[key]


def zero_shot_tags(embedder: Embedder, member_vectors: np.ndarray) -> dict[str, list[str]]:
    """Vote over cluster members: each image picks its best term per category."""
    tags: dict[str, list[str]] = {}
    top_n = {"garment": 3, "material": 2, "style": 3, "color": 2}
    for cat, (terms, text_vecs) in _prompt_embeddings(embedder).items():
        sims = member_vectors @ text_vecs.T  # (members, terms)
        # Soft vote: rank terms by mean similarity, ties broken by best-per-image counts.
        votes = np.bincount(np.argmax(sims, axis=1), minlength=len(terms))
        order = np.lexsort((-sims.mean(axis=0), -votes))
        tags[cat] = [terms[i] for i in order[: top_n[cat]]]
    return tags


def queries_from_tags(tags: dict[str, list[str]]) -> list[str]:
    g, m, s, c = tags.get("garment", []), tags.get("material", []), tags.get("style", []), tags.get("color", [])
    out: list[str] = []
    if g:
        if m:
            out.append(f"{c[0] + ' ' if c else ''}{m[0]} {g[0]}")
            out.append(f"vintage {m[0]} {g[0]}")
        if s:
            out.append(f"{s[0]} {g[0]}")
        for garment in g[1:3]:
            out.append(f"vintage {garment}" if not s else f"{s[0]} {garment}")
    seen, unique = set(), []
    for q in out:
        q = _dedupe_words(q)
        if q.lower() not in seen:
            seen.add(q.lower())
            unique.append(q)
    return unique[:5]


def _dedupe_words(q: str) -> str:
    """'denim denim jacket' -> 'denim jacket'; 'vintage vintage workwear chore coat' -> ..."""
    words, out = q.split(), []
    for w in words:
        if not out or out[-1].lower() != w.lower():
            if w.lower() not in (x.lower() for x in out):
                out.append(w)
    return " ".join(out)


# --------------------------------------------------------------------------- scoring


@dataclass
class TasteProfile:
    board: np.ndarray            # (n, d) moodboard image vectors
    clusters: list[Cluster]
    liked: np.ndarray | None = None
    noped: np.ndarray | None = None

    @property
    def centroids(self) -> np.ndarray:
        return np.array([c.centroid for c in self.clusters])

    def score(self, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Score listing vectors. Returns (scores, best cluster index per listing).

        score = 0.5 * mean of top-3 similarities to individual board images
              + 0.5 * similarity to the nearest cluster centroid
              + 0.3 * (nearest liked item - nearest noped item)   [once feedback exists]
        """
        if len(x) == 0:
            return np.zeros(0), np.zeros(0, dtype=int)
        sims = x @ self.board.T
        k = min(3, sims.shape[1])
        nn = np.sort(sims, axis=1)[:, -k:].mean(axis=1)
        csims = x @ self.centroids.T
        best_cluster = np.argmax(csims, axis=1)
        score = 0.5 * nn + 0.5 * csims.max(axis=1)
        if self.liked is not None and len(self.liked):
            score += 0.3 * (x @ self.liked.T).max(axis=1)
        if self.noped is not None and len(self.noped):
            score -= 0.3 * (x @ self.noped.T).max(axis=1)
        return score, best_cluster


def build_profile(embedder: Embedder, board_ids: list[int], board: np.ndarray) -> TasteProfile:
    labels, centers = cluster_board(board)
    clusters = []
    for j in range(len(centers)):
        idx = np.where(labels == j)[0]
        tags = zero_shot_tags(embedder, board[idx])
        clusters.append(Cluster(j, centers[j], [board_ids[i] for i in idx], tags, queries_from_tags(tags)))
    # Largest cluster first: it gets the most feed slots and query budget.
    clusters.sort(key=lambda c: -len(c.member_ids))
    for i, c in enumerate(clusters):
        c.index = i
    return TasteProfile(board=board, clusters=clusters)


# --------------------------------------------------------------------------- filters


_TOKEN = re.compile(r"[a-z0-9]+(?:[./][a-z0-9]+)?")


def passes_filters(listing: dict, prefs: dict, usd_price: float | None) -> bool:
    title = (listing.get("title") or "").lower()
    for term in prefs.get("exclude_terms") or []:
        if term and term.lower() in title:
            return False
    if usd_price is not None:
        if prefs.get("min_price") is not None and usd_price < float(prefs["min_price"]):
            return False
        if prefs.get("max_price") is not None and usd_price > float(prefs["max_price"]):
            return False
    size_terms = [s.lower().strip() for s in prefs.get("size_terms") or [] if s.strip()]
    if size_terms:
        sizes = [s.lower() for s in listing.get("sizes") or []]
        if sizes:
            # Match whole tokens so "m" doesn't match "medium-weight" but does match "m / 38".
            size_tokens = {tok for s in sizes for tok in _TOKEN.findall(s)} | set(sizes)
            if not any(t in size_tokens for t in size_terms):
                return False
        # No size info (common on marketplaces): keep it rather than hide good items.
    return True


# Words too generic to count as a keyword match on secondhand sites.
_GENERIC = {"vintage", "mens", "men's", "men", "the", "and", "with", "style"}


def keyword_rank(texts: list[str], query: str) -> list[int]:
    """Baseline relevance for sources with no search API (Shopify), mimicking a
    shop's own search box: an item must contain at least two of the query's words
    (all of them for one- or two-word queries), best matches first. Returns indices."""
    words = [w for w in query.lower().split() if len(w) > 2 and w not in _GENERIC]
    if not words:
        return []
    need = min(len(words), 2)
    hits = []
    for i, t in enumerate(texts):
        t = t.lower()
        n = sum(1 for w in words if re.search(rf"\b{re.escape(w)}", t))
        if n >= need:
            hits.append((n, i))
    hits.sort(key=lambda h: -h[0])  # stable: ties keep the caller's order
    return [i for _, i in hits]


# --------------------------------------------------------------------------- feed building


def diversify(ids: list[str], scores: dict[str, float], cluster_of: dict[str, int], cluster_sizes: list[int]) -> list[str]:
    """Interleave per-cluster rankings so every taste direction gets feed slots,
    in proportion to how much of the board it covers."""
    per: dict[int, list[str]] = {}
    for i in sorted(ids, key=lambda i: -scores[i]):
        per.setdefault(cluster_of[i], []).append(i)
    total = sum(cluster_sizes) or 1
    weights = {c: cluster_sizes[c] / total if c < len(cluster_sizes) else 0.1 for c in per}
    credit = {c: 0.0 for c in per}
    out: list[str] = []
    while any(per.values()):
        for c in credit:
            credit[c] += weights[c]
        c = max((c for c in per if per[c]), key=lambda c: credit[c])
        credit[c] -= 1
        out.append(per[c].pop(0))
    return out


def dedupe_near(ids: list[str], vecs: dict[str, np.ndarray], threshold: float = 0.97) -> list[str]:
    """Drop near-identical photos (the same item cross-listed or relisted)."""
    kept: list[str] = []
    kept_vecs: list[np.ndarray] = []
    for i in ids:
        v = vecs[i]
        if kept_vecs and float(np.max(np.array(kept_vecs) @ v)) >= threshold:
            continue
        kept.append(i)
        kept_vecs.append(v)
    return kept


def team_draft_interleave(ours: list[str], baseline: list[str], k: int, seed: int | None = None) -> list[tuple[str, str]]:
    """Team-draft interleaving (Radlinski et al. 2008): a blind, unbiased way to
    compare two rankings with one user. Each pick is credited to the team that
    drafted it; more likes for 'ours' means the taste ranking beats keyword search."""
    rng = random.Random(seed)
    result: list[tuple[str, str]] = []
    used: set[str] = set()
    ia = ib = 0
    count = {"ours": 0, "baseline": 0}

    def next_from(lst: list[str], i: int) -> int:
        while i < len(lst) and lst[i] in used:
            i += 1
        return i

    while len(result) < k:
        ia, ib = next_from(ours, ia), next_from(baseline, ib)
        a_left, b_left = ia < len(ours), ib < len(baseline)
        if not a_left and not b_left:
            break
        pick_ours = a_left and (not b_left or count["ours"] < count["baseline"] or (count["ours"] == count["baseline"] and rng.random() < 0.5))
        if pick_ours:
            item, team = ours[ia], "ours"
        else:
            item, team = baseline[ib], "baseline"
        used.add(item)
        count[team] += 1
        result.append((item, team))
    return result


def round_robin(lists: Iterable[list[str]]) -> list[str]:
    lists = [list(lst) for lst in lists]
    out, seen = [], set()
    while any(lists):
        for lst in lists:
            while lst:
                item = lst.pop(0)
                if item not in seen:
                    seen.add(item)
                    out.append(item)
                    break
    return out
