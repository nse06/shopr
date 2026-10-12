import { afterEach, describe, expect, it, vi } from "vitest";
import { depopSearch, parseDepop } from "@/lib/server/depop";

const item = (over: Record<string, unknown> = {}) => ({
  productId: 101,
  slug: "seller-vintage-chore-coat",
  productUrl: "https://www.depop.com/products/seller-vintage-chore-coat/",
  title: "Vintage chore coat",
  description: "Faded   blue\nworkwear jacket, great condition",
  brandName: "Carhartt",
  price: "64.00",
  currency: "USD",
  size: "M",
  condition: "Used - Excellent",
  gender: "male",
  isSold: false,
  imageUrl: "https://media-photos.depop.com/b1/101/P0.jpg",
  ...over,
});

describe("Depop listings", () => {
  it("turns scraper results into listings", () => {
    const [l] = parseDepop([item()]);
    expect(l).toEqual({
      id: "depop:101",
      source: "Depop",
      title: "Carhartt Vintage chore coat",
      price: 64,
      currency: "USD",
      priceUsd: 64,
      url: "https://www.depop.com/products/seller-vintage-chore-coat/",
      image: "https://media-photos.depop.com/b1/101/P0.jpg",
      thumb: "https://media-photos.depop.com/b1/101/P0.jpg",
      sizes: ["M"],
      condition: "Used - Excellent",
      details: "Faded blue workwear jacket, great condition",
    });
  });

  it("skips sold, photo-less and repeated listings, and the other department", () => {
    const items = [
      item(),
      item({ productId: 101 }), // the same listing twice
      item({ productId: 102, isSold: true }),
      item({ productId: 103, imageUrl: undefined, imageUrls: [] }),
      item({ productId: 104, gender: "female" }),
      item({ productId: 105, imageUrl: undefined, imageUrls: ["https://media-photos.depop.com/b1/105/P0.jpg"], brandName: "" }),
    ];
    expect(parseDepop(items, "men").map((l) => l.id)).toEqual(["depop:101", "depop:105"]);
    expect(parseDepop(items, "any").map((l) => l.id)).toEqual(["depop:101", "depop:104", "depop:105"]);
    expect(parseDepop([item({ price: null, title: "Carhartt jacket size L" })])[0]).toMatchObject({ price: null, title: "Carhartt jacket size L" });
  });
});

describe("Depop search through Apify", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("runs the actor once per search, asking for ten listings", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify_api_test");
    const fetchMock = vi.fn(async () => Response.json([item()]));
    vi.stubGlobal("fetch", fetchMock);
    const scraped: number[] = [];
    const out = await depopSearch("chore coat", { department: "any", onScraped: (n) => scraped.push(n) });
    expect(out.map((l) => l.id)).toEqual(["depop:101"]);
    expect(scraped).toEqual([1]); // what Apify bills for
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/api\.apify\.com\/v2\/acts\/khadinakbar~depop-scraper\/run-sync-get-dataset-items\?/);
    expect(url).toContain("timeout=45");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer apify_api_test");
    expect(JSON.parse(init.body as string)).toEqual({
      mode: "search",
      searchQueries: ["chore coat"],
      country: "us",
      maxItems: 10,
      maxPages: 1,
      fetchDetails: false,
    });
  });

  it("explains failures in plain words", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify_api_test");
    for (const [status, words] of [
      [401, "didn't accept the token"],
      [402, "out of credit"],
      [408, "slow to answer"],
      [500, "HTTP 500"],
    ] as const) {
      vi.stubGlobal("fetch", async () => new Response("{}", { status }));
      await expect(depopSearch("x", { department: "any" })).rejects.toThrow(words);
    }
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(depopSearch("x", { department: "any" })).rejects.toThrow("Couldn't reach Apify");
  });
});
