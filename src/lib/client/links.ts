"use client";

// Listing links go through shopr's /go, which counts the tap, adds referral tags and
// sends the person on.

import type { ClickWhere } from "../types";
import { useApp, type BoardItem } from "./store";

/** The creator a quarter or more of your board came from (the biggest share), if any. */
export function creditedCreator(board: BoardItem[]): string | null {
  const counts = new Map<string, number>();
  for (const b of board) if (b.from) counts.set(b.from.handle, (counts.get(b.from.handle) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [handle, n] of counts) {
    if (n > most) {
      best = handle;
      most = n;
    }
  }
  return best && most * 4 >= board.length ? best : null;
}

type Target = { url: string; source: string; title?: string; priceUsd?: number | null };

export function goUrl(target: Target, where: ClickWhere, via: string | null): string {
  const q = new URLSearchParams({ u: target.url, s: target.source, w: where });
  if (target.title) q.set("t", target.title.slice(0, 120));
  if (target.priceUsd != null) q.set("p", String(Math.round(target.priceUsd)));
  if (via) q.set("v", via);
  return `/go?${q}`;
}

/** goUrl, credited to the creator behind your board. */
export function useGo(): (target: Target, where: ClickWhere) => string {
  const { board } = useApp();
  const via = creditedCreator(board);
  return (target, where) => goUrl(target, where, via);
}
