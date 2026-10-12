"""Turning user input (photos, videos, links) into moodboard images."""

from __future__ import annotations

import re
import subprocess
import tempfile
import uuid
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

import httpx
from PIL import Image

from .embedder import load_image
from .sources.base import USER_AGENT

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"}
MAX_SIDE = 1024


class IngestError(Exception):
    pass


def save_image(img: Image.Image, media_dir: Path) -> str:
    media_dir.mkdir(parents=True, exist_ok=True)
    img = img.copy()
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    name = f"{uuid.uuid4().hex}.jpg"
    img.save(media_dir / name, format="JPEG", quality=90)
    return name


def is_video(filename: str | None, content_type: str | None) -> bool:
    if content_type and content_type.startswith("video/"):
        return True
    return bool(filename) and Path(filename).suffix.lower() in VIDEO_EXTS


def _ffmpeg() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def video_frames(data: bytes, suffix: str = ".mp4", count: int = 5) -> list[Image.Image]:
    """Grab frames spread across the clip. Near-duplicate frames are removed later
    by embedding similarity, so a static outfit video ends up as one image."""
    ffmpeg = _ffmpeg()
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"in{suffix or '.mp4'}"
        src.write_bytes(data)
        probe = subprocess.run([ffmpeg, "-i", str(src)], capture_output=True, text=True)
        m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", probe.stderr)
        if not m:
            raise IngestError("Couldn't read that video.")
        duration = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
        frames = []
        for i in range(count):
            t = duration * (i + 0.5) / count
            out = Path(tmp) / f"f{i}.jpg"
            subprocess.run(
                [ffmpeg, "-y", "-ss", f"{t:.2f}", "-i", str(src), "-frames:v", "1", "-q:v", "3", str(out)],
                capture_output=True,
            )
            if out.exists():
                # Close the file before the temp dir is removed (Windows can't delete open files).
                with Image.open(out) as frame:
                    frames.append(frame.convert("RGB"))
        if not frames:
            raise IngestError("Couldn't extract frames from that video.")
        return frames


class _MetaImageParser(HTMLParser):
    KEYS = ("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src")

    def __init__(self) -> None:
        super().__init__()
        self.found: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "meta":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        key = (a.get("property") or a.get("name") or "").lower()
        if key in self.KEYS and a.get("content") and key not in self.found:
            self.found[key] = a["content"]

    def best(self) -> str | None:
        return next((self.found[k] for k in self.KEYS if k in self.found), None)


def image_url_from_html(html: str, base_url: str) -> str | None:
    p = _MetaImageParser()
    p.feed(html)
    url = p.best()
    return urljoin(base_url, url) if url else None


async def fetch_url_media(url: str) -> tuple[bytes, str | None, str]:
    """Download a link. Direct image/video links are used as-is; for web pages
    (Pinterest pins, product pages, many social posts) we follow the og:image tag.
    Returns (bytes, content type, filename hint)."""
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
        try:
            r = await client.get(url)
        except httpx.HTTPError as e:
            raise IngestError(f"Couldn't fetch that link: {e}") from e
        if r.status_code != 200:
            raise IngestError(f"That link returned HTTP {r.status_code}.")
        ctype = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
        if ctype.startswith("image/") or ctype.startswith("video/"):
            return r.content, ctype, Path(str(r.url.path)).name
        if "html" in ctype:
            img_url = image_url_from_html(r.text, str(r.url))
            if not img_url:
                raise IngestError(
                    "Couldn't find an image on that page. Instagram and TikTok often hide it from apps; "
                    "try a screenshot instead."
                )
            r2 = await client.get(img_url)
            if r2.status_code != 200:
                raise IngestError(f"The page's image returned HTTP {r2.status_code}.")
            return r2.content, (r2.headers.get("content-type") or "").split(";")[0], Path(str(r2.url.path)).name
        raise IngestError(f"Unsupported link content type: {ctype or 'unknown'}")


def decode_image(data: bytes) -> Image.Image:
    try:
        return load_image(data)
    except Exception as e:  # PIL raises a variety of errors for bad input
        raise IngestError("That file isn't an image we can read.") from e
