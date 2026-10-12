"use client";

// Your public board, and copying from other people's.
//
// Publishing: claim a handle (this device gets a secret key; the server keeps only
// its hash), upload any photos not uploaded yet, then save the board's layout.

import { place, readingOrder, tilt } from "../board-layout";
import type { BoardSummary, PublicBoard, PublicPhoto, StyleProfile } from "../types";
import { call, failure, importLink, Locked } from "./api";
import { processPhoto } from "./images";
import { boardForAI, getState, newId, setState, type BoardItem, type Publish } from "./store";

export const MAX_PUBLIC_PHOTOS = 60;

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Your publishing details, made the first time they're needed. */
function myPublish(): Publish {
  const current = getState().publish;
  if (current) return current;
  const fresh: Publish = { key: randomKey(), handle: null, name: "", bio: "", link: "", uploaded: {}, publishedAt: null, signature: null };
  setState({ publish: fresh });
  return fresh;
}

/** The photos that go public: the first 60, from the top of the board. */
export function photosToShare(board: BoardItem[]): BoardItem[] {
  return readingOrder(board).slice(0, MAX_PUBLIC_PHOTOS);
}

/** A fingerprint of what publishing would put up, to tell whether the public board is behind. */
export function shareSignature(details: Pick<Publish, "name" | "bio" | "link">, board: BoardItem[], profileAt: number | null): string {
  const photos = photosToShare(board).map((b) => [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.w), tilt(b)].join(":"));
  return JSON.stringify([details.name.trim(), details.bio.trim(), details.link.trim(), profileAt, photos]);
}

function blobOf(dataUrl: string): Blob {
  const [head, data = ""] = dataUrl.split(",", 2);
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return new Blob([bytes], { type: head.match(/^data:([^;,]+)/)?.[1] ?? "image/jpeg" });
}

/** Run a job for each item, a few at a time. After a failure no new jobs start, and it throws once the running ones finish. */
async function pool<T>(items: T[], limit: number, job: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: { error: unknown } | null = null;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        await job(items[i], i);
      } catch (error) {
        failed ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw (failed as { error: unknown }).error;
}

/**
 * A style read numbers photos ("photos 2 and 5"); `from` lists photo ids in its
 * current numbering and `to` in the new one. Photos missing from `to` are dropped.
 */
export function renumber(profile: StyleProfile, from: string[], to: string[]): StyleProfile {
  const position = new Map(to.map((id, i) => [id, i + 1]));
  return {
    ...profile,
    directions: profile.directions.map((d) => ({
      ...d,
      photos: d.photos.map((n) => position.get(from[n - 1] ?? "")).filter((n): n is number => n !== undefined),
    })),
  };
}

function problemText(e: unknown): string | null {
  if (e instanceof Locked) return null;
  if (e instanceof TypeError) return "Couldn't reach shopr. Check your connection and try again.";
  return (e as Error).message;
}

const json = (key: string) => ({ "x-owner-key": key, "Content-Type": "application/json" });

/** Publish your board (or update it). Resolves to whether it worked. */
export async function publishBoard(details: { handle: string; name: string; bio: string; link: string }): Promise<boolean> {
  if (getState().publishing) return false;
  let pub: Publish = { ...myPublish(), name: details.name.trim(), bio: details.bio.trim(), link: details.link.trim() };
  const save = (patch: Partial<Publish>) => {
    pub = { ...pub, ...patch };
    setState({ publish: pub });
  };
  save({});
  setState({ publishing: pub.handle ? "Publishing" : "Saving your handle", publishError: null });

  try {
    if (!pub.handle) {
      const res = await call("/api/boards", { method: "POST", headers: json(pub.key), body: JSON.stringify({ handle: details.handle }) });
      if (!res.ok) throw new Error(await failure(res));
      const { handle } = (await res.json()) as { handle: string };
      save({ handle, uploaded: {} });
    }
    const handle = pub.handle!;

    // What goes up is the board as it is now, even if it changes while photos upload.
    const { board, profile: read } = getState();
    const photos = photosToShare(board);
    const keep = new Set(photos.map((p) => p.id));
    const uploaded = Object.fromEntries(Object.entries(pub.uploaded).filter(([id]) => keep.has(id)));
    const todo = photos.filter((p) => !uploaded[p.id]);
    let done = 0;
    if (todo.length) setState({ publishing: `Uploading photos (0 of ${todo.length})` });
    await pool(todo, 3, async (item) => {
      const res = await call(`/api/boards/${handle}/photos?id=${encodeURIComponent(item.id)}`, {
        method: "POST",
        headers: { "x-owner-key": pub.key, "Content-Type": "image/jpeg" },
        body: blobOf(item.image),
      });
      if (!res.ok) throw new Error(await failure(res));
      uploaded[item.id] = ((await res.json()) as { url: string }).url;
      save({ uploaded: { ...uploaded } });
      setState({ publishing: `Uploading photos (${++done} of ${todo.length})` });
    });

    setState({ publishing: "Publishing" });
    const body = {
      name: pub.name,
      bio: pub.bio,
      link: pub.link || null,
      photos: photos.map((p) => ({
        id: p.id,
        url: uploaded[p.id],
        aspect: Math.min(10, Math.max(0.1, p.aspect)),
        x: p.x,
        y: p.y,
        w: p.w,
        rot: tilt(p),
        z: Math.max(0, Math.round(p.z)),
      })),
      // On the public board, a read's photo numbers count through its photos in order.
      profile: read ? renumber(read.profile, read.boardKey.split(","), photos.map((p) => p.id)) : null,
    };
    const res = await call(`/api/boards/${handle}`, { method: "PUT", headers: json(pub.key), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await failure(res));
    save({ publishedAt: Date.now(), signature: shareSignature(pub, photos, read?.at ?? null) });
    setState({ publishing: null });
    return true;
  } catch (e) {
    setState({ publishing: null, publishError: problemText(e) });
    return false;
  }
}

/** Take your board down. Your handle is freed and the photos are deleted. */
export async function unpublishBoard(): Promise<boolean> {
  const { publish: pub, publishing } = getState();
  if (!pub?.handle || publishing) return false;
  setState({ publishing: "Taking your board down", publishError: null });
  try {
    const res = await call(`/api/boards/${pub.handle}`, { method: "DELETE", headers: { "x-owner-key": pub.key } });
    if (!res.ok && res.status !== 404) throw new Error(await failure(res));
    setState((s) => ({
      publishing: null,
      publish: s.publish && { ...s.publish, handle: null, uploaded: {}, publishedAt: null, signature: null },
    }));
    return true;
  } catch (e) {
    setState({ publishing: null, publishError: problemText(e) });
    return false;
  }
}

export async function findBoards(q: string, signal?: AbortSignal): Promise<BoardSummary[]> {
  const res = await fetch(`/api/boards?q=${encodeURIComponent(q)}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(await failure(res));
  return ((await res.json()) as { boards: BoardSummary[] }).boards;
}

/** A public board's photo, as a file this browser can process. */
async function photoBlob(url: string): Promise<Blob> {
  if (url.startsWith("/")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Couldn't get that photo. Try again.");
    return res.blob();
  }
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (res.ok) return await res.blob();
  } catch {
    // The store didn't allow a direct download: shopr fetches it instead.
  }
  return importLink(url);
}

/** Pin one photo from someone's board onto yours. */
export async function copyPhoto(board: PublicBoard, photo: PublicPhoto, columns: number): Promise<void> {
  const processed = await processPhoto(await photoBlob(photo.url));
  setState((s) => {
    const id = newId();
    const z = s.board.reduce((m, i) => Math.max(m, i.z), 0) + 1;
    const item: BoardItem = { id, ...processed, ...place(s.board, columns, id), z, addedAt: Date.now(), from: { handle: board.handle, photo: photo.id } };
    return { board: [...s.board, item] };
  });
}

/**
 * Copy a whole board onto yours. An empty board takes its arrangement and its style
 * read as they are (so it needn't be read again); otherwise each photo is pinned into
 * your columns like any new photo.
 */
export async function copyBoard(
  board: PublicBoard,
  columns: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ copied: number; failed: number }> {
  const photos = readingOrder(board.photos);
  const made: (BoardItem | null)[] = photos.map(() => null);
  const base = Date.now();
  let done = 0;
  await pool(photos, 4, async (photo, i) => {
    try {
      const processed = await processPhoto(await photoBlob(photo.url));
      made[i] = { id: newId(), ...processed, x: photo.x, y: photo.y, w: photo.w, rot: photo.rot, z: photo.z, addedAt: base + i, from: { handle: board.handle, photo: photo.id } };
    } catch (e) {
      if (e instanceof Locked) throw e;
    }
    onProgress?.(++done, photos.length);
  });
  const items = made.filter((m): m is BoardItem => m !== null);
  if (items.length) {
    setState((s) => {
      if (s.board.length) {
        const next = [...s.board];
        let z = next.reduce((m, i) => Math.max(m, i.z), 0);
        for (const it of items) next.push({ ...it, ...place(next, columns, it.id), rot: it.rot, z: ++z });
        return { board: next };
      }
      const next = items;
      if (!board.profile) return { board: next };
      const local = new Map(items.map((it) => [it.from!.photo, it.id]));
      const readIds = boardForAI(next).map((b) => b.id);
      const profile = renumber(board.profile, board.photos.map((p) => local.get(p.id) ?? ""), readIds);
      return { board: next, profile: { profile, boardKey: readIds.join(","), at: Date.now() }, readError: null };
    });
  }
  return { copied: items.length, failed: photos.length - items.length };
}
