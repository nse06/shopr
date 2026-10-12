"""Image/text embeddings in a shared space.

The real embedder is Marqo-FashionSigLIP, a SigLIP model fine-tuned on fashion
product data: it captures cut, fabric, era and wash much better than keywords do.
`FakeEmbedder` is a deterministic stand-in used by the tests (no torch needed).
"""

from __future__ import annotations

import hashlib
import io
import threading
from typing import Protocol

import numpy as np
from PIL import Image, ImageOps

try:  # iPhone photos are often HEIC
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # pragma: no cover
    pass

MODEL_ID = "hf-hub:Marqo/marqo-fashionSigLIP"


class Embedder(Protocol):
    dim: int

    def embed_images(self, images: list[Image.Image]) -> np.ndarray: ...

    def embed_texts(self, texts: list[str]) -> np.ndarray: ...


def load_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        # Flatten transparency onto white, like a product photo.
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        return bg
    return img.convert("RGB")


def _normalize(x: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(x, axis=-1, keepdims=True)
    return (x / np.maximum(norms, 1e-12)).astype(np.float32)


class SiglipEmbedder:
    dim = 768

    def __init__(self, batch_size: int = 32):
        import logging

        import open_clip
        import torch

        # Hugging Face's servers send a "you're not logged in" warning with each model
        # download check. The model is public, so it's just noise in the shopr window.
        logging.getLogger("huggingface_hub").setLevel(logging.ERROR)

        self._torch = torch
        if torch.cuda.is_available():
            self.device = "cuda"
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            self.device = "mps"
        else:
            self.device = "cpu"
        model, _, preprocess = open_clip.create_model_and_transforms(MODEL_ID)
        self.model = model.to(self.device).eval()
        self.preprocess = preprocess
        self.tokenizer = open_clip.get_tokenizer(MODEL_ID)
        self.batch_size = batch_size
        self._lock = threading.Lock()  # torch modules aren't safe to share across threads

    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        if not images:
            return np.zeros((0, self.dim), dtype=np.float32)
        out = []
        with self._lock, self._torch.no_grad():
            for i in range(0, len(images), self.batch_size):
                batch = self._torch.stack([self.preprocess(im) for im in images[i : i + self.batch_size]])
                out.append(self.model.encode_image(batch.to(self.device), normalize=True).cpu().numpy())
        return _normalize(np.concatenate(out))

    def embed_texts(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        out = []
        with self._lock, self._torch.no_grad():
            for i in range(0, len(texts), 256):
                tokens = self.tokenizer(texts[i : i + 256]).to(self.device)
                out.append(self.model.encode_text(tokens, normalize=True).cpu().numpy())
        return _normalize(np.concatenate(out))


class FakeEmbedder:
    """Deterministic embeddings: an image maps to a vector derived from its
    downsampled pixels (so similar images get similar vectors), a text from its hash."""

    dim = 64

    def embed_images(self, images: list[Image.Image]) -> np.ndarray:
        rows = []
        for im in images:
            small = np.asarray(im.convert("RGB").resize((4, 4)), dtype=np.float32).reshape(-1)  # 48 values
            rows.append(np.concatenate([small / 255.0 - 0.5, np.zeros(self.dim - small.size, dtype=np.float32)]))
        return _normalize(np.array(rows, dtype=np.float32)) if rows else np.zeros((0, self.dim), np.float32)

    def embed_texts(self, texts: list[str]) -> np.ndarray:
        rows = []
        for t in texts:
            seed = int.from_bytes(hashlib.sha256(t.encode()).digest()[:8], "little")
            rows.append(np.random.default_rng(seed).standard_normal(self.dim))
        return _normalize(np.array(rows, dtype=np.float32)) if rows else np.zeros((0, self.dim), np.float32)


def make_embedder(kind: str) -> Embedder:
    if kind == "fake":
        return FakeEmbedder()
    if kind == "siglip":
        return SiglipEmbedder()
    raise ValueError(f"Unknown embedder {kind!r} (expected 'siglip' or 'fake')")
