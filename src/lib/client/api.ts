"use client";

import type { ChatEvent, HistoryTurn, Listing, Status, StyleProfile } from "../types";
import { boardForAI, boardKey, getPassword, getState, newId, setState, type Intent, type Shown, type StylistTurn, type Turn } from "./store";

export class Locked extends Error {}

export async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const password = getPassword();
  if (password) headers.set("x-shopr-password", password);
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    setState({ locked: true });
    throw new Locked("This shopr is private. Enter the password.");
  }
  return res;
}

export async function failure(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // not JSON
  }
  if (res.status === 413) return "That was too much to send at once. Remove a few moodboard photos and try again.";
  if (res.status === 504) return "That took too long. Try again.";
  return `Something went wrong (HTTP ${res.status}). Try again.`;
}

export async function refreshStatus(): Promise<Status | null> {
  try {
    const res = await fetch("/api/status", {
      headers: getPassword() ? { "x-shopr-password": getPassword()! } : {},
      cache: "no-store",
    });
    const status = (await res.json()) as Status;
    setState({ status, locked: status.passwordRequired && !status.authorized });
    return status;
  } catch {
    return null;
  }
}

/** Lines of JSON from a streamed response. */
export async function* readEvents(res: Response): AsyncGenerator<ChatEvent> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as ChatEvent;
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as ChatEvent;
}

function boardPhotos(): string[] {
  return boardForAI(getState().board).map((b) => b.ai);
}

export function formatPrice(price: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(price);
  } catch {
    return `${Math.round(price)} ${currency ?? ""}`.trim();
  }
}

function shownOf(picks: Listing[]): Shown[] {
  return picks.slice(0, 9).map((p) => ({
    title: p.title,
    price: p.price == null ? "price not listed" : formatPrice(p.price, p.currency),
    source: p.source,
  }));
}

function historyFor(chat: Turn[]): HistoryTurn[] {
  return chat
    .filter((t) => !(t.role === "stylist" && t.error))
    .slice(-12)
    .map((t) => {
      if (t.role === "user") return { role: "user", text: t.text };
      // Conversations saved by the first version kept whole picks on each turn.
      const legacy = (t as { picks?: Listing[] }).picks;
      return { role: "stylist", text: t.text, picks: t.shown ?? (legacy ? shownOf(legacy) : undefined) };
    });
}

// What the stylist is asked when nobody typed anything.
const ASK: Record<Exclude<Intent, "chat">, string> = {
  feed: "Pick things for me from my moodboard. Cover the different directions in it.",
  more: "Find more for me in the same spirit as the picks you've shown me, but different pieces.",
};

export type Outgoing = {
  text?: string;
  intent?: Intent; // chat (default): a message; feed: fresh picks from the board; more: extend the current picks
  photo?: { data: string; preview: string } | null; // a photo from this device
  photoUrl?: string | null; // a listing photo ("More like this"); the server fetches it
};

/**
 * Ask the stylist for picks. Runs outside any page, so it keeps going if you
 * switch screens. A chat message or "new picks" replaces the picks on the home
 * screen; "more" adds to them.
 */
export async function sendMessage({ text = "", intent = "chat", photo, photoUrl }: Outgoing): Promise<void> {
  const s = getState();
  if (s.pending) return;
  const message = intent === "chat" ? text.trim() || "Find me something like this." : ASK[intent];
  const history = historyFor(s.chat);
  // New picks and "more" should bring new pieces; a new request may reuse anything.
  const seen = intent === "chat" ? [] : (s.feed?.picks ?? []).map((p) => p.id).slice(-300);
  const freshProfile = s.profile && s.profile.boardKey === boardKey(s.board) ? s.profile.profile : null;

  const chat =
    intent === "chat"
      ? [...s.chat, { id: newId(), role: "user" as const, text: message, photo: photo?.preview ?? photoUrl ?? undefined, at: Date.now() }]
      : s.chat;
  setState({ chat, pending: { intent, status: "Thinking", notices: [], startedAt: Date.now() }, feedError: null, moreNote: null });

  const say = (turn: Omit<StylistTurn, "id" | "role" | "at">) => ({ id: newId(), role: "stylist" as const, at: Date.now(), ...turn });
  const fail = (text: string) =>
    setState((now) =>
      intent === "chat"
        ? { pending: null, chat: [...now.chat, say({ text, followUps: [], error: true })] }
        : { pending: null, feedError: { intent, text } },
    );

  try {
    const res = await call("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        photo: photo?.data ?? null,
        photoUrl: photo ? null : (photoUrl ?? null),
        history,
        board: boardPhotos(),
        profile: freshProfile,
        prefs: s.prefs,
        seen,
      }),
    });
    if (!res.ok) return fail(await failure(res));
    for await (const event of readEvents(res)) {
      if (event.type === "status") setState((now) => ({ pending: now.pending && { ...now.pending, status: event.text } }));
      else if (event.type === "notice")
        setState((now) => ({ pending: now.pending && { ...now.pending, notices: [...now.pending.notices, event.text] } }));
      else if (event.type === "error") return fail(event.text);
      else if (event.type === "reply") {
        return setState((now) => {
          if (intent === "more") {
            const have = new Set((now.feed?.picks ?? []).map((p) => p.id));
            const added = event.picks.filter((p) => !have.has(p.id));
            return {
              pending: null,
              moreNote: added.length ? null : event.message,
              feed: now.feed ? { ...now.feed, picks: [...now.feed.picks, ...added] } : { picks: added, request: null, query: event.query, at: Date.now() },
            };
          }
          const turn = say({ text: event.message, followUps: event.followUps, shown: shownOf(event.picks) });
          return {
            pending: null,
            chat: [...now.chat, turn],
            // A reply without picks (advice) leaves the current picks alone.
            feed: event.picks.length
              ? { picks: event.picks, request: intent === "feed" ? null : message, query: event.query, at: Date.now() }
              : now.feed,
          };
        });
      }
    }
    fail("The connection dropped before your stylist finished. Try again.");
  } catch (e) {
    if (e instanceof Locked) return setState({ pending: null });
    fail("Couldn't reach shopr. Check your connection and try again.");
  }
}

/** Ask again: after a failed reply, or when no reply came back (the page was closed mid-answer). */
export function retryLast(): void {
  const { chat, pending } = getState();
  if (pending || !chat.length) return;
  const last = chat[chat.length - 1];
  const failed = last.role === "stylist" && last.error;
  const asked = failed ? chat[chat.length - 2] : last;
  if (!asked || asked.role !== "user" || (last.role === "stylist" && !failed)) return;
  setState({ chat: chat.slice(0, failed ? -2 : -1) });
  const photo = asked.photo?.startsWith("data:") ? { data: asked.photo.split(",", 2)[1], preview: asked.photo } : null;
  sendMessage({ text: asked.text, photo, photoUrl: photo ? null : asked.photo });
}

/** Ask Claude to read the moodboard. */
export async function readBoard(): Promise<void> {
  const s = getState();
  if (s.reading) return;
  const items = boardForAI(s.board);
  if (items.length < 3) return;
  const key = boardKey(s.board);
  setState({ reading: true, readError: null });
  try {
    const res = await call("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board: boardPhotos(), prefs: s.prefs }),
    });
    if (!res.ok) return setState({ reading: false, readError: await failure(res) });
    const { profile } = (await res.json()) as { profile: StyleProfile };
    setState({ reading: false, profile: { profile, boardKey: key, at: Date.now() } });
  } catch (e) {
    setState({ reading: false, readError: e instanceof Locked ? null : "Couldn't reach shopr. Try again." });
  }
}

/** Turn a pasted link into a photo (the server fetches it). */
export async function importLink(url: string): Promise<Blob> {
  const res = await call("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await failure(res));
  return res.blob();
}
