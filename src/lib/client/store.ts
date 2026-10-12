"use client";

// Everything the app remembers lives in this browser (IndexedDB): the moodboard,
// the current picks, the conversation, saved pieces, sizes and budget, the latest
// read of the board, and the key to your public board if you've shared it.

import { createStore, get, set, type UseStore } from "idb-keyval";
import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, type Listing, type Prefs, type Status, type StyleProfile } from "../types";

export type BoardItem = {
  id: string;
  image: string; // data URL shown on the board
  ai: string; // small base64 JPEG that Claude looks at
  aspect: number; // height / width
  x: number;
  y: number;
  w: number; // board units: the board is 1000 wide
  z: number;
  rot?: number; // tilt in degrees; photos pinned before tilts existed get one from their id
  addedAt: number;
  from?: { handle: string; photo: string }; // copied from someone's public board
};

export type Shown = { title: string; price: string; source: string };

export type UserTurn = { id: string; role: "user"; text: string; photo?: string; at: number };
export type StylistTurn = {
  id: string;
  role: "stylist";
  text: string;
  followUps: string[];
  shown?: Shown[]; // the picks it put on the home screen, for its memory of the conversation
  at: number;
  error?: boolean;
};
export type Turn = UserTurn | StylistTurn;

/** The current picks: ranked best first. The home screen shows the first nine. */
export type Feed = {
  picks: Listing[];
  request: string | null; // what was asked for; null = picked from the board
  query: string | null; // the stylist's first search, for links to other sites
  at: number;
  note?: string; // a drop's one line on what it leans into
};

/** Today's drops: how many there have been and what they showed, so each brings new pieces. */
export type Drops = { day: string; round: number; shown: string[] };

export type Intent = "chat" | "feed" | "more";

export type SavedItem = Listing & { savedAt: number };
export type PassedItem = { id: string; title: string; source: string; at: number }; // tapped "Not for me"
export type ProfileRecord = { profile: StyleProfile; boardKey: string; at: number };

/** Your public board. The key proves this device owns it (the server keeps only its hash). */
export type Publish = {
  key: string;
  handle: string | null; // null until a handle is claimed
  name: string;
  bio: string;
  link: string;
  uploaded: Record<string, string>; // board photo id -> its public URL
  publishedAt: number | null;
  signature: string | null; // what was last published, to notice changes since
};

export type State = {
  loaded: boolean;
  board: BoardItem[];
  feed: Feed | null;
  chat: Turn[];
  saved: SavedItem[];
  prefs: Prefs;
  profile: ProfileRecord | null;
  publish: Publish | null;
  passed: PassedItem[]; // newest first
  drops: Drops | null;
  // Not stored:
  status: Status | null;
  locked: boolean; // the server wants a password
  pending: { intent: Intent; status: string; notices: string[]; startedAt: number } | null; // a request in progress
  feedError: { intent: Intent; text: string } | null; // picking from the board or finding more failed
  moreNote: string | null; // what the stylist said when finding more
  reading: boolean; // a board read in progress
  readError: string | null;
  publishing: string | null; // what publishing is doing right now
  publishError: string | null;
};

const STORED = ["board", "feed", "chat", "saved", "prefs", "profile", "publish", "passed", "drops"] as const;
type StoredKey = (typeof STORED)[number];

const INITIAL: State = {
  loaded: false,
  board: [],
  feed: null,
  chat: [],
  saved: [],
  prefs: DEFAULT_PREFS,
  profile: null,
  publish: null,
  passed: [],
  drops: null,
  status: null,
  locked: false,
  pending: null,
  feedError: null,
  moreNote: null,
  reading: false,
  readError: null,
  publishing: null,
  publishError: null,
};

let state: State = INITIAL;
const listeners = new Set<() => void>();
let db: UseStore | null = null;
const timers = new Map<StoredKey, ReturnType<typeof setTimeout>>();

function idb(): UseStore {
  db ??= createStore("shopr", "kv");
  return db;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): State {
  return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const changes = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...changes };
  listeners.forEach((l) => l());
  if (!state.loaded) return;
  for (const key of STORED) {
    if (!(key in changes)) continue;
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        set(key, state[key], idb()).catch((e) => console.warn("couldn't save", key, e));
      }, 250),
    );
  }
}

export function useApp(): State {
  return useSyncExternalStore(subscribe, getState, () => INITIAL);
}

let loading: Promise<void> | null = null;

export function loadStore(): Promise<void> {
  loading ??= (async () => {
    const values = await Promise.all(STORED.map((k) => get(k, idb()).catch(() => undefined)));
    const loaded: Partial<State> = {};
    STORED.forEach((key, i) => {
      if (values[i] !== undefined) (loaded as Record<string, unknown>)[key] = values[i];
    });
    state = { ...state, ...loaded, prefs: { ...DEFAULT_PREFS, ...(loaded.prefs ?? {}) }, loaded: true };
    listeners.forEach((l) => l());
  })();
  return loading;
}

/** Write anything waiting to be saved (when the page is being hidden). */
export function flush() {
  for (const [key, timer] of timers) {
    clearTimeout(timer);
    set(key, state[key], idb()).catch(() => {});
  }
  timers.clear();
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

// --- Password (kept in localStorage so it survives reloads) ---

const PASSWORD_KEY = "shopr:password";

export function getPassword(): string | null {
  try {
    return localStorage.getItem(PASSWORD_KEY);
  } catch {
    return null;
  }
}

export function savePassword(value: string | null) {
  try {
    if (value) localStorage.setItem(PASSWORD_KEY, value);
    else localStorage.removeItem(PASSWORD_KEY);
  } catch {
    // private mode: the password just won't be remembered
  }
}

// --- Small helpers used across pages ---

// Vercel accepts requests up to 4.5 MB; leave room for the rest of the message.
const BOARD_BUDGET = 3_300_000;

/** The photos Claude sees, numbered from 1: the 36 most recently added, oldest first. */
export function boardForAI(board: BoardItem[]): BoardItem[] {
  const items = [...board].sort((a, b) => a.addedAt - b.addedAt).slice(-36);
  let total = items.reduce((n, b) => n + b.ai.length, 0);
  while (total > BOARD_BUDGET && items.length) total -= items.shift()!.ai.length;
  return items;
}

export function boardKey(board: BoardItem[]): string {
  return boardForAI(board)
    .map((b) => b.id)
    .join(",");
}

export function toggleSaved(listing: Listing) {
  setState((s) =>
    s.saved.some((x) => x.id === listing.id)
      ? { saved: s.saved.filter((x) => x.id !== listing.id) }
      : { saved: [{ ...listing, savedAt: Date.now() }, ...s.saved] },
  );
}

/** "Not for me": take a pick off the feed (the next one moves up) and remember it. Returns where it was, for undo. */
export function passOn(listing: Listing): number {
  const index = state.feed?.picks.findIndex((p) => p.id === listing.id) ?? -1;
  setState((s) => ({
    passed: [{ id: listing.id, title: listing.title, source: listing.source, at: Date.now() }, ...s.passed.filter((p) => p.id !== listing.id)].slice(0, 200),
    feed: s.feed && { ...s.feed, picks: s.feed.picks.filter((p) => p.id !== listing.id) },
  }));
  return index;
}

export function undoPass(listing: Listing, index: number) {
  setState((s) => {
    if (!s.feed) return { passed: s.passed.filter((p) => p.id !== listing.id) };
    const picks = s.feed.picks.filter((p) => p.id !== listing.id);
    if (index >= 0) picks.splice(Math.min(index, picks.length), 0, listing);
    return { passed: s.passed.filter((p) => p.id !== listing.id), feed: { ...s.feed, picks } };
  });
}

export function setPrefs(patch: Partial<Prefs>) {
  setState((s) => ({ prefs: { ...s.prefs, ...patch } }));
}
