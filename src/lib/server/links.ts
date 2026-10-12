// Where "view listing" taps may go, and the tags that credit shopr for the visit.

import { SHOPS } from "./shops";

// Marketplaces shopr links to, plus the 20 independent shops. Anything else is refused,
// so /go can't be used to send people to arbitrary sites.
const MARKETPLACES = ["depop.com", "grailed.com", "poshmark.com", "vinted.com"];
const EBAY = /(^|\.)ebay\.(com|us|ca|co\.uk|com\.au|de|fr|it|es|ie|at|ch|nl|be|pl)$/;

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function isEbay(url: URL): boolean {
  return EBAY.test(url.hostname.toLowerCase());
}

export function shopFor(url: URL) {
  const host = url.hostname.toLowerCase();
  return SHOPS.find((s) => onDomain(host, s.domain)) ?? null;
}

/** The listing address if shopr may send people there, otherwise null. */
export function allowedDestination(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  return isEbay(url) || MARKETPLACES.some((d) => onDomain(host, d)) || shopFor(url) ? url : null;
}

/** "maya.vintage" -> "maya_vintage": the characters referral networks accept in a tag. */
const tagSafe = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 40);

/**
 * Add shopr's tags to a destination: eBay referral links (from the Partner Network)
 * get a custom ID naming the creator whose board led there, so sales can be credited;
 * the independent shops get UTM tags, so they can see the visits in their own analytics.
 */
export function tagged(url: URL, via: string | null): URL {
  const out = new URL(url);
  if (isEbay(out) && out.searchParams.has("campid")) {
    out.searchParams.set("customid", via ? `shopr-via-${tagSafe(via)}` : "shopr");
  } else if (shopFor(out) && !out.searchParams.has("utm_source")) {
    out.searchParams.set("utm_source", "shopr");
    out.searchParams.set("utm_medium", "referral");
    if (via) out.searchParams.set("utm_campaign", `via-${tagSafe(via)}`);
  }
  return out;
}
