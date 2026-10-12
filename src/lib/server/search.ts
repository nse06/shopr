// Runs the searches Claude asks for and turns the results into a short list of
// candidates (with photos) for Claude to look at.

import type { Department, Kind, Listing, Prefs } from "../types";
import type { Meter } from "./costs";
import { cachedDepop, depopConfigured, depopSearch } from "./depop";
import { ebayConfigured, ebayImageSearch, ebaySearch } from "./ebay";
import { fetchPhoto, type Photo } from "./fetching";
import { SHOPS, searchShop } from "./shops";
import { avoidTerms, mentionsAny, priceOk, sizeOk } from "./sizes";

export const MAX_CANDIDATES = 30;
// Depop runs cost per listing, so only the first two searches go there.
const DEPOP_SEARCHES = 2;

export type SearchInput = {
  searches: { query: string; shop_query: string; kind: Kind }[];
  use_attached_photo: boolean;
  board_photos: number[];
  min_price: number | null;
  max_price: number | null;
};

export type SearchContext = {
  prefs: Prefs;
  seen: Set<string>; // listings already shown in this conversation
  photo: string | null; // base64 JPEG the person attached to this message
  board: string[]; // base64 JPEGs of the moodboard, numbered from 1
  signal?: AbortSignal;
  meter?: Meter; // adds up what the request spends
  depopSearches?: number; // how many of the searches also go to Depop (default 2)
  maxCandidates?: number; // listings with photos to hand back (default 30)
  photoSide?: number; // the long side of those photos, in pixels (default 512)
};

export type Candidate = { listing: Listing; photo: Photo };

export type SearchOutcome = {
  candidates: Candidate[];
  found: number; // listings that passed the filters, before trimming
  problems: string[]; // things to tell the person (eBay failed, ...)
  summary: string; // what was searched, for Claude
};

type Lane = { label: string; items: Listing[] };

export type Deps = {
  ebaySearch: typeof ebaySearch;
  ebayImageSearch: typeof ebayImageSearch;
  depopSearch: typeof depopSearch;
  searchShop: typeof searchShop;
  fetchPhoto: typeof fetchPhoto;
  ebayConfigured: () => boolean;
  depopConfigured: () => boolean;
};

// Depop searches are remembered for the day, so the same search is only paid for once.
const realDeps: Deps = { ebaySearch, ebayImageSearch, depopSearch: cachedDepop(depopSearch), searchShop, fetchPhoto, ebayConfigured, depopConfigured };

/** Run tasks with at most `limit` in flight. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** Shop results interleaved: each shop's best match first, then each shop's second, ... */
export function interleave(lists: Listing[][]): Listing[] {
  const out: Listing[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

/** Take from each lane in turn so every search gets a fair share of the slots. */
export function roundRobin(lanes: Lane[], limit: number): Listing[] {
  const out: Listing[] = [];
  const seen = new Set<string>();
  const cursors = lanes.map(() => 0);
  let progressed = true;
  while (out.length < limit && progressed) {
    progressed = false;
    lanes.forEach((lane, i) => {
      while (cursors[i] < lane.items.length && out.length < limit) {
        const item = lane.items[cursors[i]++];
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
        progressed = true;
        break;
      }
    });
  }
  return out;
}

export function keep(listing: Listing, prefs: Prefs, min: number | null, max: number | null, avoid: string[]): boolean {
  return priceOk(listing.priceUsd, min, max) && sizeOk(listing, prefs) && !mentionsAny(listing.title, avoid);
}

export async function runSearch(input: SearchInput, ctx: SearchContext, deps: Deps = realDeps): Promise<SearchOutcome> {
  const depopCount = ctx.depopSearches ?? DEPOP_SEARCHES;
  const maxCandidates = ctx.maxCandidates ?? MAX_CANDIDATES;
  const searches = input.searches
    .map((s) => ({ ...s, query: s.query.trim().slice(0, 120), shop_query: (s.shop_query || s.query).trim().slice(0, 60) }))
    .filter((s) => s.query)
    .filter((s, i, all) => all.findIndex((t) => t.query.toLowerCase() === s.query.toLowerCase()) === i)
    .slice(0, 4);
  const min = input.min_price ?? ctx.prefs.minPrice;
  const max = input.max_price ?? ctx.prefs.maxPrice;
  const department: Department = ctx.prefs.department;
  const ebayOn = deps.ebayConfigured();
  const depopOn = deps.depopConfigured();
  const problems: string[] = [];
  let ebayFailed = false;
  let depopFailed = false;
  let shopFailures = 0;

  const ebayOpts = (kind: Kind) => ({ kind, department, minUsd: min, maxUsd: max, signal: ctx.signal });
  const ebayTask = (label: string, run: () => Promise<Listing[]>) => async (): Promise<Lane> => {
    try {
      return { label, items: await run() };
    } catch (e) {
      if (!ebayFailed) problems.push((e as Error).message);
      ebayFailed = true;
      return { label, items: [] };
    }
  };

  // Every search goes to eBay, Depop and every shop at once.
  const depopLanes = searches.slice(0, depopOn ? depopCount : 0).map((s) => async (): Promise<Lane> => {
    let counted = false;
    const onScraped = (listings: number) => {
      counted = true;
      ctx.meter?.depopRun(listings);
    };
    try {
      return { label: `Depop: ${s.query}`, items: await deps.depopSearch(s.query, { department, signal: ctx.signal, onScraped }) };
    } catch (e) {
      if (!counted) ctx.meter?.depopRun(0); // a run that failed may still have started
      if (!depopFailed) problems.push((e as Error).message);
      depopFailed = true;
      return { label: `Depop: ${s.query}`, items: [] };
    }
  });
  const ebayLanes: (() => Promise<Lane>)[] = [];
  const shopTasks: (() => Promise<{ search: number; items: Listing[] }>)[] = [];
  searches.forEach((s, i) => {
    if (ebayOn) ebayLanes.push(ebayTask(`eBay: ${s.query}`, () => deps.ebaySearch(s.query, ebayOpts(s.kind))));
    for (const shop of SHOPS) {
      shopTasks.push(async () => {
        try {
          return { search: i, items: await deps.searchShop(shop, s.shop_query, ctx.signal) };
        } catch {
          shopFailures++;
          return { search: i, items: [] };
        }
      });
    }
  });

  const photoLanes: (() => Promise<Lane>)[] = [];
  if (ebayOn) {
    const kind = searches[0]?.kind ?? "clothing";
    if (input.use_attached_photo && ctx.photo) {
      const photo = ctx.photo;
      photoLanes.push(ebayTask("eBay: like your photo", () => deps.ebayImageSearch(photo, ebayOpts(kind))));
    }
    for (const n of input.board_photos.slice(0, 2)) {
      const image = ctx.board[n - 1];
      if (image) photoLanes.push(ebayTask(`eBay: like board photo ${n}`, () => deps.ebayImageSearch(image, ebayOpts(kind))));
    }
  }

  const [ebayResults, depopResults, shopResults, photoResults] = await Promise.all([
    pool(ebayLanes, 4),
    pool(depopLanes, Math.max(1, depopCount)),
    pool(shopTasks, 24),
    pool(photoLanes, 2),
  ]);

  const avoid = avoidTerms(ctx.prefs);
  const filter = (items: Listing[]) => items.filter((l) => !ctx.seen.has(l.id) && keep(l, ctx.prefs, min, max, avoid));

  const lanes: Lane[] = [];
  searches.forEach((s, i) => {
    const ebay = ebayResults[i]; // one eBay lane per search when eBay is connected
    if (ebay) lanes.push({ label: ebay.label, items: filter(ebay.items) });
    const depop = depopResults[i]; // Depop for the first searches when it's connected
    if (depop) lanes.push({ label: depop.label, items: filter(depop.items) });
    const perShop = shopResults.filter((r) => r.search === i).map((r) => filter(r.items));
    lanes.push({ label: `shops: ${s.shop_query}`, items: interleave(perShop) });
  });
  for (const r of photoResults) lanes.push({ label: r.label, items: filter(r.items) });

  const found = new Set(lanes.flatMap((l) => l.items.map((i) => i.id))).size;
  // Pick a few extra in case some photos don't load.
  const chosen = roundRobin(lanes, maxCandidates + 8);
  const photos = await pool(chosen.map((l) => () => deps.fetchPhoto(l.thumb, ctx.signal, undefined, ctx.photoSide)), 12);
  const candidates: Candidate[] = [];
  chosen.forEach((listing, i) => {
    const photo = photos[i];
    if (photo && candidates.length < maxCandidates) candidates.push({ listing, photo });
  });

  if (shopFailures > SHOPS.length * searches.length * 0.5) problems.push("Many of the independent shops didn't answer this time.");

  const sources = [
    ebayOn ? (ebayFailed ? "eBay (failed this time)" : "eBay") : "eBay is not connected",
    depopOn ? (depopFailed ? "Depop (failed this time)" : `Depop (first ${Math.min(depopCount, searches.length) === 1 ? "search" : `${Math.min(depopCount, searches.length)} searches`})`) : "Depop is not connected",
    `${SHOPS.length} independent shops`,
  ].join("; ");
  const summary =
    `Searched ${searches.map((s) => `"${s.query}" (shops: "${s.shop_query}")`).join(", ")}` +
    (photoLanes.length ? ` plus ${photoLanes.length} photo search${photoLanes.length > 1 ? "es" : ""}` : "") +
    `. Sources: ${sources}. Budget ${min ?? "any"}-${max ?? "any"} USD. ` +
    `${found} listings passed the size and budget filters; showing ${candidates.length}, mixed across searches and shops.`;

  return { candidates, found, problems, summary };
}
