// eBay Browse API: keyword search and visual (photo) search.
//
// Needs a free eBay developer account: create a Production keyset at
// https://developer.ebay.com/my/keys and set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.
// Uses the client-credentials grant, so nobody has to sign in to eBay.
// Optional: EBAY_CAMPAIGN_ID (eBay Partner Network) turns links into affiliate links.

import type { Department, Kind, Listing } from "../types";
import { guessSizes, toUsd } from "./sizes";

const API = "https://api.ebay.com";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

// eBay takes one category per search.
const CATEGORIES: Record<Department, Record<Kind, string>> = {
  men: { clothing: "1059", shoes: "93427", accessories: "4250" },
  women: { clothing: "15724", shoes: "3034", accessories: "4251" },
  any: { clothing: "11450", shoes: "11450", accessories: "11450" }, // Clothing, Shoes & Accessories
};

export class EbayError extends Error {}

export function ebayConfigured(): boolean {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}

let cachedToken: { value: string; expires: number } | null = null;

export function resetEbayToken() {
  cachedToken = null;
}

async function token(signal?: AbortSignal): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires - 60_000) return cachedToken.value;
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }),
    signal: withTimeout(signal, 10_000),
  });
  if (!r.ok) {
    throw new EbayError(
      r.status === 400 || r.status === 401
        ? "eBay didn't accept the keys. Check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (use the Production keyset)."
        : `eBay sign-in failed (HTTP ${r.status}).`,
    );
  }
  const body = (await r.json()) as { access_token: string; expires_in?: number };
  cachedToken = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 7200) * 1000 };
  return cachedToken.value;
}

async function headers(signal?: AbortSignal): Promise<Record<string, string>> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${await token(signal)}`,
    "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE || "EBAY_US",
  };
  if (process.env.EBAY_CAMPAIGN_ID) h["X-EBAY-C-ENDUSERCTX"] = `affiliateCampaignId=${process.env.EBAY_CAMPAIGN_ID}`;
  return h;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

/** eBay's price filter: price:[10..50], price:[10] (10 and up) or price:[..50]. */
export function priceFilter(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  const range = max == null ? `${min}` : `${min ?? ""}..${max}`;
  return `price:[${range}],priceCurrency:USD`;
}

export function categoryFor(kind: Kind, department: Department): string {
  return CATEGORIES[department][kind];
}

type SearchOptions = {
  kind: Kind;
  department: Department;
  minUsd: number | null;
  maxUsd: number | null;
  limit?: number;
  signal?: AbortSignal;
};

/** Search in one category; if eBay rejects the category, search again without it. */
async function withCategory(
  category: string,
  params: Record<string, string>,
  send: (params: URLSearchParams, h: Record<string, string>) => Promise<Response>,
  signal?: AbortSignal,
): Promise<Response> {
  const h = await headers(signal);
  const r = await send(new URLSearchParams({ ...params, category_ids: category }), h);
  if (r.status !== 400) return r;
  return send(new URLSearchParams(params), h);
}

function baseParams(o: SearchOptions): Record<string, string> {
  const params: Record<string, string> = { limit: String(o.limit ?? 30) };
  const f = priceFilter(o.minUsd, o.maxUsd);
  if (f) params.filter = f;
  return params;
}

export async function ebaySearch(query: string, o: SearchOptions): Promise<Listing[]> {
  const r = await withCategory(
    categoryFor(o.kind, o.department),
    { ...baseParams(o), q: query },
    (p, h) => fetch(`${API}/buy/browse/v1/item_summary/search?${p}`, { headers: h, signal: withTimeout(o.signal, 10_000) }),
    o.signal,
  );
  if (!r.ok) throw new EbayError(`eBay search "${query}" failed (HTTP ${r.status}).`);
  return parseItems(await r.json());
}

export async function ebayImageSearch(imageBase64: string, o: SearchOptions): Promise<Listing[]> {
  const body = JSON.stringify({ image: imageBase64 });
  const r = await withCategory(
    categoryFor(o.kind, o.department),
    baseParams(o),
    (p, h) =>
      fetch(`${API}/buy/browse/v1/item_summary/search_by_image?${p}`, {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body,
        signal: withTimeout(o.signal, 15_000),
      }),
    o.signal,
  );
  if (!r.ok) throw new EbayError(`eBay photo search failed (HTTP ${r.status}).`);
  return parseItems(await r.json());
}

function resized(url: string | undefined, size: number): string | null {
  // eBay photo URLs encode the size as s-l<N>.
  return url ? url.replace(/s-l\d+/, `s-l${size}`) : null;
}

type EbayItem = {
  itemId: string;
  title?: string;
  price?: { value?: string; currency?: string };
  currentBidPrice?: { value?: string; currency?: string };
  image?: { imageUrl?: string };
  thumbnailImages?: { imageUrl?: string }[];
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  condition?: string;
  shortDescription?: string;
};

export function parseItems(body: { itemSummaries?: EbayItem[] }): Listing[] {
  const out: Listing[] = [];
  for (const item of body.itemSummaries ?? []) {
    const photo = item.image?.imageUrl ?? item.thumbnailImages?.find((t) => t.imageUrl)?.imageUrl;
    const url = item.itemAffiliateWebUrl || item.itemWebUrl;
    const image = resized(photo, 1600);
    const thumb = resized(photo, 500);
    if (!url || !image || !thumb) continue;
    const p = item.price ?? item.currentBidPrice ?? {};
    const value = p.value != null ? Number(p.value) : null;
    const price = value != null && Number.isFinite(value) ? value : null;
    // No seller details are kept: only public listing info, never eBay user data.
    out.push({
      id: `ebay:${item.itemId}`,
      source: "eBay",
      title: item.title ?? "",
      price,
      currency: p.currency ?? "USD",
      priceUsd: toUsd(price, p.currency ?? "USD"),
      url,
      image,
      thumb,
      sizes: guessSizes(item.title ?? ""),
      condition: item.condition ?? null,
      details: item.shortDescription?.slice(0, 240) ?? "",
    });
  }
  return out;
}
