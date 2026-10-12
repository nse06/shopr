import type { Department, Listing, Prefs } from "../types";

// Rough rates for comparing prices across shop currencies. Good enough for a
// budget check; the page shows each listing's own price.
const USD_PER_UNIT: Record<string, number> = {
  USD: 1, CAD: 0.73, AUD: 0.66, NZD: 0.6, GBP: 1.33, EUR: 1.16, CHF: 1.25,
  SEK: 0.105, DKK: 0.156, NOK: 0.098, JPY: 0.0067, KRW: 0.00073, HKD: 0.128,
};

export function toUsd(price: number | null, currency: string | null): number | null {
  if (price == null) return null;
  const rate = USD_PER_UNIT[(currency || "USD").toUpperCase()];
  return rate ? Math.round(price * rate * 100) / 100 : null;
}

const SIZE_TAG = /(?:^|[|:_\s])size(?: adults)?[|:\s]+([a-z0-9][a-z0-9 ./-]{0,10})$/i;
const SIZE_IN_TITLE = new RegExp(
  String.raw`(?:\bsz\.?|\bsize)\s*[:\-]?\s*(?<a>[0-9]{1,2}(?:\.5)?(?:\s*x\s*[0-9]{2})?|xxs|xs|s|m|l|xl|xxl|xxxl|[0-9]xl)\b` +
    String.raw`|\s[-|]\s*(?<b>xxs|xs|s|m|l|xl|xxl|xxxl|[0-9]xl)\b` +
    String.raw`|\bw(?<c>[0-9]{2})\b`, // jeans: W32 x L30 -> waist 32
  "i",
);

/** Read sizes from tags ("Size|L", "size:M") or the title ("... - L", "SZ M", "Size 32", "W32"). */
export function guessSizes(title: string, tags: string[] = []): string[] {
  const sizes: string[] = [];
  for (const tag of tags) {
    const m = SIZE_TAG.exec(tag.trim());
    if (m) sizes.push(m[1].trim().toUpperCase());
  }
  const m = SIZE_IN_TITLE.exec(title);
  const found = m?.groups?.a ?? m?.groups?.b ?? m?.groups?.c;
  if (found) sizes.push(found.trim().toUpperCase());
  return [...new Set(sizes)];
}

function sizeTokens(size: string): string[] {
  // "32x30" -> 32, x, 30; "M / 38" -> m, 38; "2XL" stays whole.
  return size.toLowerCase().match(/\d+xl|[a-z]+|\d+(?:\.5)?/g) ?? [];
}

/** False only when the listing states its size and it isn't one of the person's sizes. */
export function sizeOk(listing: Pick<Listing, "sizes">, prefs: Pick<Prefs, "tops" | "waist" | "shoes">): boolean {
  const wanted = [...prefs.tops, ...prefs.waist, ...prefs.shoes].map((s) => s.toLowerCase().trim()).filter(Boolean);
  if (!wanted.length || !listing.sizes.length) return true;
  const have = new Set(listing.sizes.flatMap((s) => [s.toLowerCase(), ...sizeTokens(s)]));
  return wanted.some((w) => have.has(w));
}

const ALWAYS_AVOID = ["replica", "lot of", "bundle", "costume", "wholesale"];
const OTHER_DEPARTMENT: Record<Department, string[]> = {
  men: ["women's", "womens", "woman's"],
  women: ["men's", "mens"],
  any: [],
};

export function avoidTerms(prefs: Pick<Prefs, "avoid" | "department">): string[] {
  const own = prefs.avoid.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  return [...ALWAYS_AVOID, ...OTHER_DEPARTMENT[prefs.department], ...own];
}

/** Whole-word match, so "men's" doesn't hit "women's". */
export function mentionsAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((t) => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(lower);
  });
}

export function priceOk(usd: number | null, min: number | null, max: number | null): boolean {
  if (usd == null) return true;
  if (min != null && usd < min) return false;
  if (max != null && usd > max) return false;
  return true;
}
