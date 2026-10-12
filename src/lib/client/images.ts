"use client";

// Shrinking photos in the browser before they're stored or sent: a large copy for
// the board, a small JPEG for Claude. Videos contribute one still frame.

const BOARD_MAX = 1200;
const AI_MAX = 512;

type Drawable = ImageBitmap | HTMLImageElement | HTMLVideoElement;

function size(source: Drawable): { w: number; h: number } {
  if (source instanceof HTMLVideoElement) return { w: source.videoWidth, h: source.videoHeight };
  if (source instanceof HTMLImageElement) return { w: source.naturalWidth, h: source.naturalHeight };
  return { w: source.width, h: source.height };
}

function toJpeg(source: Drawable, max: number, quality: number): string {
  const { w, h } = size(source);
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process photos.");
  ctx.fillStyle = "#fff"; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function decodeImage(blob: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // fall back to an <img> below
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error("That file isn't a photo this browser can open.");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function waitFor(target: EventTarget, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    target.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true });
    target.addEventListener("error", () => (clearTimeout(timer), reject(new Error("error"))), { once: true });
  });
}

/** A still from a third of the way into a video. */
async function videoFrame(blob: Blob): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = URL.createObjectURL(blob);
  try {
    await waitFor(video, "loadeddata", 10_000);
    const target = Number.isFinite(video.duration) ? Math.max(0, Math.min(video.duration * 0.33, video.duration - 0.1)) : 0;
    if (target > 0) {
      video.currentTime = target;
      await waitFor(video, "seeked", 5000).catch(async () => {
        // Some phones only render frames after playback starts.
        await video.play().catch(() => {});
        video.pause();
      });
    }
    return video;
  } catch {
    throw new Error("Couldn't read that video. Try a screenshot of it instead.");
  }
}

export type ProcessedPhoto = { image: string; ai: string; aspect: number };

export async function processPhoto(blob: Blob): Promise<ProcessedPhoto> {
  const isVideo = blob.type.startsWith("video/");
  const source = isVideo ? await videoFrame(blob) : await decodeImage(blob);
  try {
    const { w, h } = size(source);
    if (!w || !h) throw new Error("That photo looks empty.");
    const image = toJpeg(source, BOARD_MAX, 0.85);
    const ai = toJpeg(source, AI_MAX, 0.8).split(",", 2)[1];
    return { image, ai, aspect: h / w };
  } finally {
    if (source instanceof ImageBitmap) source.close();
    if (source instanceof HTMLVideoElement) URL.revokeObjectURL(source.src);
  }
}

/** A photo attached to a chat message: a preview for the conversation and a JPEG for the stylist. */
export async function processChatPhoto(blob: Blob): Promise<{ preview: string; data: string }> {
  const source = blob.type.startsWith("video/") ? await videoFrame(blob) : await decodeImage(blob);
  try {
    return { preview: toJpeg(source, 600, 0.8), data: toJpeg(source, 1024, 0.82).split(",", 2)[1] };
  } finally {
    if (source instanceof ImageBitmap) source.close();
    if (source instanceof HTMLVideoElement) URL.revokeObjectURL(source.src);
  }
}
