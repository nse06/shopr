// Public boards. Anyone can look; only the owner can change one.
//
// There are no accounts yet: the first person to claim a handle gets a private key
// (kept in their browser) and the store keeps only its hash. Layout in the store:
//   owners/<handle>.json          { hash, createdAt }
//   boards/<handle>/board.json    the board people see
//   boards/<handle>/photos/<id>.jpg
//   index.json                    short summaries, for Explore and search

import { createHash, timingSafeEqual } from "node:crypto";
import type { BoardSummary, PublicBoard } from "../types";
import { Conflict, updateJson, type Store } from "./storage";

export const MAX_PUBLIC_PHOTOS = 60;
// Photos a handle may keep uploaded at once: room to swap every photo of a full board
// before the update clears out the old ones.
export const MAX_STORED_PHOTOS = MAX_PUBLIC_PHOTOS * 2;

const RESERVED = new Set([
  "about", "admin", "api", "board", "boards", "edit", "explore", "help", "me", "more", "new", "saved", "settings", "shopr", "u", "you",
]);

const ownerPath = (handle: string) => `owners/${handle}.json`;
const boardPath = (handle: string) => `boards/${handle}/board.json`;
export const photoPrefix = (handle: string) => `boards/${handle}/photos/`;
export const photoPath = (handle: string, id: string) => `${photoPrefix(handle)}${id}.jpg`;
const INDEX = "index.json";

type Owner = { hash: string; createdAt: number };
type Index = { boards: BoardSummary[] };

const clean = (raw: string) => raw.trim().replace(/^@/, "").toLowerCase();

/** "@Some.One" -> "some.one"; null if it can't be a handle. */
export function normalizeHandle(raw: string): string | null {
  const h = clean(raw);
  return /^[a-z0-9][a-z0-9_.]{1,23}$/.test(h) && !h.endsWith(".") && !RESERVED.has(h) ? h : null;
}

/** Names kept for the app's own pages. */
export function isReserved(raw: string): boolean {
  return RESERVED.has(clean(raw));
}

export function validKey(key: string | null): key is string {
  return Boolean(key && /^[A-Za-z0-9_-]{32,128}$/.test(key));
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function isOwner(s: Store, handle: string, key: string): Promise<boolean> {
  const owner = await s.readJson<Owner>(ownerPath(handle));
  return Boolean(owner && sameHash(owner.data.hash, hashKey(key)));
}

/** Claim a handle for this key. "yours" when the key already owns it. */
export async function claimHandle(s: Store, handle: string, key: string): Promise<"created" | "yours" | "taken"> {
  const existing = await s.readJson<Owner>(ownerPath(handle));
  if (existing) return sameHash(existing.data.hash, hashKey(key)) ? "yours" : "taken";
  try {
    await s.writeJson(ownerPath(handle), { hash: hashKey(key), createdAt: Date.now() } satisfies Owner, { ifMatch: null });
    return "created";
  } catch (e) {
    if (e instanceof Conflict) return (await isOwner(s, handle, key)) ? "yours" : "taken";
    throw e;
  }
}

export async function readBoard(s: Store, handle: string): Promise<PublicBoard | null> {
  return (await s.readJson<PublicBoard>(boardPath(handle)))?.data ?? null;
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

export function summarize(board: PublicBoard): BoardSummary {
  const p = board.profile;
  const tagText = p ? [p.headline, ...p.directions.map((d) => d.name), ...p.key_pieces, ...p.palette, ...p.look_for].join(" ") : "";
  return {
    handle: board.handle,
    name: board.name,
    bio: board.bio,
    headline: p?.headline ?? "",
    cover: [...board.photos].sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 4).map((ph) => ph.url),
    count: board.photos.length,
    tags: [...new Set(words(tagText))].slice(0, 60),
    updatedAt: board.updatedAt,
  };
}

async function updateIndex(s: Store, change: (boards: BoardSummary[]) => BoardSummary[]) {
  await updateJson<Index>(s, INDEX, () => ({ boards: [] }), (index) => ({ boards: change(index.boards) }));
}

/** Save a board, list it for search, and delete photos it no longer uses. */
export async function saveBoard(s: Store, board: PublicBoard): Promise<void> {
  await s.writeJson(boardPath(board.handle), board);
  const summary = summarize(board);
  await updateIndex(s, (boards) => [summary, ...boards.filter((b) => b.handle !== board.handle)]);
  const used = new Set(board.photos.map((p) => p.url));
  const stored = await s.list(photoPrefix(board.handle));
  await s.remove(stored.filter((f) => !used.has(f.url)).map((f) => f.url));
}

export async function deleteBoard(s: Store, handle: string): Promise<void> {
  await updateIndex(s, (boards) => boards.filter((b) => b.handle !== handle));
  const files = await s.list(`boards/${handle}/`);
  await s.remove(files.map((f) => f.url));
  const owner = await s.list(ownerPath(handle));
  await s.remove(owner.map((f) => f.url));
}

/** Boards whose name, handle, bio or style match every word of the query; newest first. */
export async function searchBoards(s: Store, q: string, limit = 60): Promise<BoardSummary[]> {
  const boards = (await s.readJson<Index>(INDEX))?.data.boards ?? [];
  const terms = words(q);
  const scored = boards
    .map((b) => {
      const name = `${b.name} ${b.handle}`.toLowerCase();
      const rest = `${b.bio} ${b.headline} ${b.tags.join(" ")}`.toLowerCase();
      if (!terms.every((t) => name.includes(t) || rest.includes(t))) return null;
      return { b, score: terms.filter((t) => name.includes(t)).length };
    })
    .filter((x): x is { b: BoardSummary; score: number } => x !== null);
  scored.sort((x, y) => y.score - x.score || y.b.updatedAt - x.b.updatedAt);
  return scored.slice(0, limit).map((x) => x.b);
}
