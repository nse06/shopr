import { afterEach, describe, expect, it, vi } from "vitest";
import { categoryFor, ebaySearch, parseItems, priceFilter, resetEbayToken } from "@/lib/server/ebay";
import { parseSuggest, SHOPS } from "@/lib/server/shops";
import { avoidTerms, guessSizes, mentionsAny, priceOk, sizeOk, toUsd } from "@/lib/server/sizes";
import { DEFAULT_PREFS } from "@/lib/types";

describe("sizes", () => {
  it("reads sizes from titles and tags", () => {
    expect(guessSizes("Chore Coat - L")).toEqual(["L"]);
    expect(guessSizes("French Work Jacket SZ M")).toEqual(["M"]);
    expect(guessSizes("Levi's 501 W32 x L30")).toEqual(["32"]);
    expect(guessSizes("Tee", ["size:XL"])).toEqual(["XL"]);
    expect(guessSizes("Lost in the M25")).toEqual([]);
  });

  it("keeps listings without a size, drops ones in other sizes", () => {
    const prefs = { tops: ["M", "L"], waist: ["32"], shoes: [] };
    expect(sizeOk({ sizes: [] }, prefs)).toBe(true);
    expect(sizeOk({ sizes: ["L"] }, prefs)).toBe(true);
    expect(sizeOk({ sizes: ["32X30"] }, prefs)).toBe(true);
    expect(sizeOk({ sizes: ["XL"] }, prefs)).toBe(false);
    expect(sizeOk({ sizes: ["XL"] }, { tops: [], waist: [], shoes: [] })).toBe(true);
  });

  it("matches words to leave out as whole words", () => {
    const menswear = avoidTerms({ ...DEFAULT_PREFS, department: "men" });
    expect(mentionsAny("Women's chore coat", menswear)).toBe(true);
    const womenswear = avoidTerms({ ...DEFAULT_PREFS, department: "women", avoid: "polyester" });
    expect(mentionsAny("Women's chore coat", womenswear)).toBe(false);
    expect(mentionsAny("Men's chore coat", womenswear)).toBe(true);
    expect(mentionsAny("Polyester track jacket", womenswear)).toBe(true);
  });

  it("converts prices and checks the budget", () => {
    expect(toUsd(100, "GBP")).toBe(133);
    expect(toUsd(100, "XYZ")).toBeNull();
    expect(priceOk(120, 50, 150)).toBe(true);
    expect(priceOk(200, 50, 150)).toBe(false);
    expect(priceOk(null, 50, 150)).toBe(true);
  });
});

describe("eBay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetEbayToken();
  });

  it("builds price filters and picks one category", () => {
    expect(priceFilter(null, null)).toBeNull();
    expect(priceFilter(20, null)).toBe("price:[20],priceCurrency:USD");
    expect(priceFilter(null, 150)).toBe("price:[..150],priceCurrency:USD");
    expect(priceFilter(20, 150)).toBe("price:[20..150],priceCurrency:USD");
    expect(categoryFor("shoes", "men")).toBe("93427");
    expect(categoryFor("clothing", "women")).toBe("15724");
    expect(categoryFor("accessories", "any")).toBe("11450");
  });

  it("keeps public listing info only", () => {
    const [item] = parseItems({
      itemSummaries: [
        {
          itemId: "v1|123|0",
          title: "Vintage Carhartt Chore Coat Size L",
          price: { value: "89.99", currency: "USD" },
          image: { imageUrl: "https://i.ebayimg.com/images/g/abc/s-l225.jpg" },
          itemWebUrl: "https://www.ebay.com/itm/123",
          itemAffiliateWebUrl: "https://ebay.us/aff",
          condition: "Pre-owned",
          seller: { username: "someone" },
        } as never,
      ],
    });
    expect(JSON.stringify(item)).not.toContain("someone");
    expect(item).toMatchObject({ id: "ebay:v1|123|0", price: 89.99, priceUsd: 89.99, url: "https://ebay.us/aff", sizes: ["L"] });
    expect(item.thumb).toMatch(/s-l500\.jpg$/);
    expect(item.image).toMatch(/s-l1600\.jpg$/);
  });

  it("signs in, searches one category, and retries without it if eBay refuses", async () => {
    vi.stubEnv("EBAY_CLIENT_ID", "id");
    vi.stubEnv("EBAY_CLIENT_SECRET", "secret");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (url.includes("/oauth2/token")) return Response.json({ access_token: "tok", expires_in: 7200 });
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
        if (url.includes("category_ids")) return Response.json({ errors: [{ errorId: 12030 }] }, { status: 400 });
        return Response.json({
          itemSummaries: [
            { itemId: "v1|2|0", title: "Chore coat", price: { value: "60", currency: "USD" }, image: { imageUrl: "https://i.ebayimg.com/y/s-l225.jpg" }, itemWebUrl: "https://www.ebay.com/itm/2" },
          ],
        });
      }),
    );
    const items = await ebaySearch("chore coat", { kind: "clothing", department: "men", minUsd: 20, maxUsd: 150 });
    expect(items.map((i) => i.id)).toEqual(["ebay:v1|2|0"]);
    const searches = calls.filter((c) => c.includes("item_summary/search"));
    expect(new URL(searches[0]).searchParams.get("category_ids")).toBe("1059");
    expect(new URL(searches[0]).searchParams.get("filter")).toBe("price:[20..150],priceCurrency:USD");
    expect(new URL(searches[1]).searchParams.has("category_ids")).toBe(false);
  });
});

describe("independent shops", () => {
  it("parses a shop's search results", () => {
    const shop = SHOPS.find((s) => s.currency === "GBP")!;
    const out = parseSuggest(shop, [
      { id: 7, title: "Vintage Chore Coat - L", handle: "chore", available: true, price: "115.00", image: "//cdn.shopify.com/a.jpg?v=2", body: "<p>Pit to pit 24&quot;</p>" },
      { id: 8, title: "Sold", handle: "sold", available: false, price: "1.00", image: "https://x/y.jpg" },
      { id: 9, title: "No photo", handle: "nophoto", available: true, price: "1.00" },
      { id: 0, title: "Zero id is fine", handle: "zero", available: true, price: "10", image: "https://x/z.jpg" },
    ]);
    expect(out.map((l) => l.id)).toEqual([`shop:${shop.domain}:7`, `shop:${shop.domain}:0`]);
    expect(out[0]).toMatchObject({
      source: shop.name,
      price: 115,
      currency: "GBP",
      priceUsd: 152.95,
      sizes: ["L"],
      url: `https://${shop.domain}/products/chore`,
      thumb: "https://cdn.shopify.com/a.jpg?v=2&width=400",
      details: 'Pit to pit 24"',
    });
  });
});
