// Independent vintage and archive shops on Shopify. Every Shopify shop has a public
// search box (/search/suggest.json) that answers in about a second with up to 10
// in-stock products, so all of them can be searched at once.

import type { Listing } from "../types";
import { guessSizes, toUsd } from "./sizes";

export type Shop = { domain: string; name: string; focus: string; currency: string };

export const SHOPS: Shop[] = [
  { domain: "denimdoctors.com", name: "Denim Doctors", focus: "vintage Levi's and denim, workwear, western", currency: "USD" },
  { domain: "frontgeneralstore.com", name: "Front General Store", focus: "vintage Americana, workwear, military, leather", currency: "USD" },
  { domain: "barnowlseattle.com", name: "The Barn Owl", focus: "vintage menswear 1920s-90s, workwear, tees, outerwear", currency: "USD" },
  { domain: "garmenttrafficker.com", name: "Garment Trafficker", focus: "80s-2000s tees, camo and workwear, streetwear", currency: "USD" },
  { domain: "thelockr.com", name: "the lockr", focus: "vintage Polo Ralph Lauren, preppy Americana", currency: "USD" },
  { domain: "archivereloaded.com", name: "Archive Reloaded", focus: "archive designer and 90s vintage, outerwear", currency: "USD" },
  { domain: "onbond.shop", name: "OnBond", focus: "archive and runway designer resale", currency: "USD" },
  { domain: "groupie.store", name: "Groupie", focus: "archive designer and high-end streetwear", currency: "USD" },
  { domain: "wornwear.patagonia.com", name: "Patagonia Worn Wear", focus: "used Patagonia fleece and outdoor wear", currency: "USD" },
  { domain: "secondhand.levi.com", name: "Levi's Secondhand", focus: "used and vintage Levi's", currency: "USD" },
  { domain: "rokit.co.uk", name: "Rokit", focus: "vintage Carhartt, denim, 70s-00s", currency: "GBP" },
  { domain: "thrifted.com", name: "Thrifted", focus: "vintage sportswear, denim, outdoor", currency: "GBP" },
  { domain: "endyma.com", name: "ENDYMA", focus: "archive Helmut Lang", currency: "EUR" },
  { domain: "broadwayandsons.com", name: "Broadway & Sons", focus: "vintage workwear, Americana, flannel, military", currency: "EUR" },
  { domain: "wasteland.dk", name: "Wasteland", focus: "vintage workwear, Dickies and Carhartt, fleece", currency: "DKK" },
  { domain: "recentestudio.com", name: "Recente Studio", focus: "archive Japanese designers: Comme des Garçons, Yohji, Issey", currency: "EUR" },
  { domain: "archive-factory.com", name: "Archive Factory", focus: "Japanese and European designer archive", currency: "USD" },
  { domain: "de.militaria-1911.com", name: "Militaria 1911", focus: "vintage US military: flight jackets, fatigues", currency: "USD" },
  { domain: "driewgarments.com", name: "DRIEW", focus: "archive Rick Owens, Yohji, avant-garde", currency: "CAD" },
  { domain: "rebalancevintage.com", name: "Rebalance Vintage", focus: "vintage tees, denim, workwear, Americana", currency: "USD" },
];

const USER_AGENT = "Mozilla/5.0 (compatible; shopr/0.2; personal stylist)";

type SuggestProduct = {
  id?: number | string | null;
  title?: string;
  handle?: string;
  available?: boolean;
  price?: string | number | null;
  image?: string | null;
  featured_image?: { url?: string } | null;
  tags?: unknown;
  body?: string;
  vendor?: string;
};

function absolute(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

function sized(url: string, width: number): string {
  // Shopify's image CDN resizes on request.
  return `${url}${url.includes("?") ? "&" : "?"}width=${width}`;
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSuggest(shop: Shop, products: SuggestProduct[]): Listing[] {
  const out: Listing[] = [];
  for (const p of products) {
    if (p.available === false || p.id == null || !p.handle) continue;
    const image = p.image || p.featured_image?.url;
    if (!image) continue;
    const price = p.price == null || p.price === "" ? null : Number(p.price);
    const tags = Array.isArray(p.tags) ? p.tags.map(String) : [];
    const details = plainText(p.body || "").slice(0, 240);
    out.push({
      id: `shop:${shop.domain}:${p.id}`,
      source: shop.name,
      title: p.title || "",
      price: price != null && Number.isFinite(price) ? price : null,
      currency: shop.currency,
      priceUsd: price != null && Number.isFinite(price) ? toUsd(price, shop.currency) : null,
      url: `https://${shop.domain}/products/${p.handle}`,
      image: sized(absolute(image), 1000),
      thumb: sized(absolute(image), 400),
      sizes: guessSizes(`${p.title || ""}`, tags),
      condition: null,
      details,
    });
  }
  return out;
}

export async function searchShop(shop: Shop, query: string, signal?: AbortSignal): Promise<Listing[]> {
  const params = new URLSearchParams({
    q: query,
    "resources[type]": "product",
    "resources[limit]": "10",
    "resources[options][unavailable_products]": "hide",
  });
  const r = await fetch(`https://${shop.domain}/search/suggest.json?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`${shop.name}: search returned HTTP ${r.status}`);
  const body = (await r.json()) as { resources?: { results?: { products?: SuggestProduct[] } } };
  return parseSuggest(shop, body.resources?.results?.products ?? []);
}
