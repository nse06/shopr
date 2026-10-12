"use client";

// Everything the app remembers lives in this browser (IndexedDB): the moodboard,
// the conversation, saved picks, sizes and budget, and the latest read of the board.

import { createStore, get, set, type UseStore } from "idb-keyval";
import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, type Pick, type Prefs, type Status, type StyleProfile } from "../types";

export type BoardItem = {
  id: string;
  image: string; // data URL shown on the board
  ai: string; // small base64 JPEG that Claude looks at
  aspect: number; // height / width
  x: number;
  y: number;
  w: number; // board units: the board is 1000 wide
  z: number;
  addedAt: number;
};

export type UserTurn = { id: string; role: "user"; text: string; photo?: string; at: number };
export type StylistTurn = {
  id: string;
  role: "stylist";
  text: string;
  picks: Pick[];
  followUps: string[];
  query: string | null;
  at: number;
  error?: boolean;
};
export type Turn = UserTurn | StylistTurn;

export type SavedItem = Pick & { savedAt: number };
export type ProfileRecord = { profile: StyleProfile; boardKey: string; at: number };

export type State = {
  loaded: boolean;
  board: BoardItem[];
  chat: Turn[];
  saved: SavedItem[];
  prefs: Prefs;
  profile: ProfileRecord | null;
  // Not stored:
  status: Status | null;
  locked: boolean; // the server wants a password
  pending: { status: string; notices: string[]; startedAt: number } | null; // a chat turn in progress
  reading: boolean; // a board read in progress
  readError: string | null;
};

const STORED = ["board", "chat", "saved", "prefs", "profile"] as const;
type StoredKey = (typeof STORED)[number];

const INITIAL: State = {
  loaded: false,
  board: [],
  chat: [],
  saved: [],
  prefs: DEFAULT_PREFS,
  profile: null,
  status: null,
  locked: false,
  pending: null,
  reading: false,
  readError: null,
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

export function toggleSaved(pick: Pick) {
  setState((s) =>
    s.saved.some((x) => x.id === pick.id)
      ? { saved: s.saved.filter((x) => x.id !== pick.id) }
      : { saved: [{ ...pick, savedAt: Date.now() }, ...s.saved] },
  );
}

export function setPrefs(patch: Partial<Prefs>) {
  setState((s) => ({ prefs: { ...s.prefs, ...patch } }));
}
