// Depop, through an Apify scraper (Depop has no public API).
//
// Set APIFY_TOKEN (Apify → Settings → API & Integrations). By default this runs the
// "khadinakbar/depop-scraper" actor; APIFY_DEPOP_ACTOR can name another actor that
// takes the same input. Each search is one short actor run, billed by Apify per
// listing returned (about half a cent each), so each search asks for ten.

import { createHash } from "node:crypto";
import type { Department, Listing } from "../types";
import { guessSizes, toUsd } from "./sizes";
import { storageConfigured, store, type Store } from "./storage";

const ACTOR = () => process.env.APIFY_DEPOP_ACTOR || "khadinakbar~depop-scraper";
const API = () => process.env.APIFY_API_BASE || "https://api.apify.com";

export const DEPOP_PER_QUERY = 10;
export const DEPOP_TIMEOUT_MS = 45_000;

export class DepopError extends Error {}

export function depopConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN);
}

type DepopItem = {
  productId?: string | number;
  slug?: string;
  productUrl?: string;
  title?: string;
  description?: string;
  brandName?: string;
  price?: number | string;
  currency?: string;
  size?: string;
  sizes?: string[];
  condition?: string;
  gender?: string;
  isSold?: boolean;
  imageUrl?: string;
  imageUrls?: string[];
  searchQuery?: string;
};

const OTHER_GENDER: Record<Department, RegExp | null> = {
  men: /^(female|women|womens|woman|girls?)$/i,
  women: /^(male|men|mens|man|boys?)$/i,
  any: null,
};

export function parseDepop(items: DepopItem[], department: Department = "any"): Listing[] {
  const out: Listing[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const url = item.productUrl;
    const image = item.imageUrl || item.imageUrls?.[0];
    if (!url || !image || item.isSold) continue;
    const other = OTHER_GENDER[department];
    if (other && item.gender && other.test(item.gender.trim())) continue;
    const key = String(item.productId ?? item.slug ?? url);
    if (seen.has(key)) continue;
    seen.add(key);
    const value = item.price == null || item.price === "" ? null : Number(item.price);
    const price = value != null && Number.isFinite(value) ? value : null;
    const currency = item.currency || "USD";
    const title = (item.title || item.description || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const stated = [item.size, ...(item.sizes ?? [])].filter((s): s is string => Boolean(s && s.trim()));
    // No seller details are kept: only public listing info.
    out.push({
      id: `depop:${key}`,
      source: "Depop",
      title: item.brandName && !title.toLowerCase().includes(item.brandName.toLowerCase()) ? `${item.brandName} ${title}`.trim() : title,
      price,
      currency,
      priceUsd: toUsd(price, currency),
      url,
      image,
      thumb: image,
      sizes: stated.length ? [...new Set(stated.map((s) => s.trim().toUpperCase()))] : guessSizes(title),
      condition: item.condition ?? null,
      details: (item.description || "").replace(/\s+/g, " ").trim().slice(0, 240),
    });
  }
  return out;
}

/** One actor run for one search; resolves to the listings it found. */
export async function depopSearch(
  query: string,
  opts: {
    department: Department;
    maxItems?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
    onScraped?: (listings: number) => void; // how many listings Apify returned (and billed)
  },
): Promise<Listing[]> {
  const timeoutMs = opts.timeoutMs ?? DEPOP_TIMEOUT_MS;
  const params = new URLSearchParams({ format: "json", clean: "true", timeout: String(Math.ceil(timeoutMs / 1000)) });
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs + 5000)]) : AbortSignal.timeout(timeoutMs + 5000);
  let r: Response;
  try {
    r = await fetch(`${API()}/v2/acts/${encodeURIComponent(ACTOR())}/run-sync-get-dataset-items?${params}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "search",
        searchQueries: [query],
        country: process.env.APIFY_DEPOP_COUNTRY || "us",
        maxItems: opts.maxItems ?? DEPOP_PER_QUERY,
        maxPages: 1,
        fetchDetails: false,
      }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") throw new DepopError("Depop was slow to answer this time.");
    throw new DepopError("Couldn't reach Apify for Depop.");
  }
  if (r.status === 401 || r.status === 403) throw new DepopError("Apify didn't accept the token. Check APIFY_TOKEN.");
  if (r.status === 402) throw new DepopError("Your Apify account is out of credit, so Depop was skipped.");
  if (r.status === 408) throw new DepopError("Depop was slow to answer this time.");
  if (!r.ok) throw new DepopError(`Depop search failed (Apify answered HTTP ${r.status}).`);
  const body = (await r.json().catch(() => null)) as unknown;
  const items = Array.isArray(body) ? (body as DepopItem[]) : [];
  opts.onScraped?.(items.length);
  return parseDepop(items, opts.department);
}

type DepopSearch = typeof depopSearch;
const DAY = 86_400_000;
const dayNumber = () => Math.floor(Date.now() / DAY);

// One actor run per search per day, shared by everyone who asks.

let cleanedOn = -1;

/** Depop searches remembered for the rest of the day, so the same search isn't paid for twice. */
export function cachedDepop(search: DepopSearch = depopSearch, storeFor: () => Store | null = () => (storageConfigured() ? store() : null)): DepopSearch {
  return async (query, opts) => {
    const s = storeFor();
    if (!s) return search(query, opts);
    const day = new Date().toISOString().slice(0, 10);
    const key = createHash("sha1").update(`${query.trim().toLowerCase()}|${opts.department}|${process.env.APIFY_DEPOP_COUNTRY || "us"}`).digest("hex").slice(0, 20);
    const path = `depop-cache/${day}/${key}.json`;
    const hit = await s.readJson<Listing[]>(path).catch(() => null);
    if (hit) return hit.data;
    const listings = await search(query, opts);
    await s.writeJson(path, listings).catch(() => {});
    if (cleanedOn !== dayNumber()) {
      cleanedOn = dayNumber();
      const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
      s.list("depop-cache/")
        .then((files) => s.remove(files.filter((f) => f.pathname.slice("depop-cache/".length, "depop-cache/".length + 10) < yesterday).map((f) => f.url)))
        .catch(() => {});
    }
    return listings;
  };
}
