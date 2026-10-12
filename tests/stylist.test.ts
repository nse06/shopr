import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Photo } from "@/lib/server/fetching";
import { interleave, keep, roundRobin, runSearch, type Deps } from "@/lib/server/search";
import { boardMessage, historyMessages, runStylist, toReply, toSearchInput, type ChatInput, type StylistDeps } from "@/lib/server/stylist";
import { DEFAULT_PREFS, type Listing } from "@/lib/types";

const listing = (id: string, extra: Partial<Listing> = {}): Listing => ({
  id,
  source: "Shop",
  title: `Item ${id}`,
  price: 50,
  currency: "USD",
  priceUsd: 50,
  url: `https://shop.example/${id}`,
  image: `https://img.example/${id}.jpg`,
  thumb: `https://img.example/${id}-small.jpg`,
  sizes: [],
  condition: null,
  details: "",
  ...extra,
});

const photo: Photo = { data: "/9j/AAAA", mediaType: "image/jpeg" };

const input = (over: Partial<ChatInput> = {}): ChatInput => ({
  message: "Find me a chore coat",
  photo: null,
  history: [],
  board: ["/9j/b1", "/9j/b2"],
  profile: null,
  prefs: DEFAULT_PREFS,
  seen: [],
  ...over,
});

function message(content: Anthropic.Beta.BetaContentBlock[], stop: Anthropic.Beta.BetaStopReason): Anthropic.Beta.BetaMessage {
  return { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: {} } as unknown as Anthropic.Beta.BetaMessage;
}

describe("search", () => {
  it("interleaves shops and shares slots between searches", () => {
    const a = [listing("a1"), listing("a2"), listing("a3")];
    const b = [listing("b1")];
    expect(interleave([a, b]).map((l) => l.id)).toEqual(["a1", "b1", "a2", "a3"]);
    const lanes = [
      { label: "x", items: a },
      { label: "y", items: [listing("a1"), ...b] },
    ];
    expect(roundRobin(lanes, 3).map((l) => l.id)).toEqual(["a1", "b1", "a2"]);
  });

  it("filters by budget, size and words to leave out", () => {
    const prefs = { ...DEFAULT_PREFS, tops: ["M"] };
    expect(keep(listing("ok"), prefs, null, 100, [])).toBe(true);
    expect(keep(listing("pricey", { priceUsd: 300 }), prefs, null, 100, [])).toBe(false);
    expect(keep(listing("big", { sizes: ["XL"] }), prefs, null, null, [])).toBe(false);
    expect(keep(listing("fake", { title: "Replica jacket" }), prefs, null, null, ["replica"])).toBe(false);
  });

  it("searches eBay and every shop, skips what was already shown, and fetches photos", async () => {
    const shopQueries: string[] = [];
    const deps: Deps = {
      ebayConfigured: () => true,
      ebaySearch: async (q) => [listing(`ebay-${q}-1`), listing("seen-before")],
      ebayImageSearch: async () => [listing("by-photo")],
      searchShop: async (shop, q) => {
        shopQueries.push(q);
        return shop.domain.startsWith("denim") ? [listing(`shop-${q}`)] : [];
      },
      fetchPhoto: async (url) => (url.includes("broken") ? null : photo),
    };
    const outcome = await runSearch(
      {
        searches: [
          { query: "vintage chore coat", shop_query: "chore coat", kind: "clothing" },
          { query: "Vintage Chore Coat", shop_query: "dupe", kind: "clothing" },
        ],
        use_attached_photo: true,
        board_photos: [],
        min_price: null,
        max_price: null,
      },
      { prefs: DEFAULT_PREFS, seen: new Set(["seen-before"]), photo: "/9j/photo", board: [] },
      deps,
    );
    expect(new Set(shopQueries)).toEqual(new Set(["chore coat"])); // the duplicate search was dropped
    expect(outcome.candidates.map((c) => c.listing.id)).toEqual(["ebay-vintage chore coat-1", "shop-chore coat", "by-photo"]);
    expect(outcome.summary).toContain("3 listings passed");
  });
});

describe("stylist", () => {
  it("opens with the moodboard, numbered, and caches it", () => {
    const m = boardMessage(input(), false);
    const blocks = m.content as Anthropic.Beta.BetaContentBlockParam[];
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(2);
    expect(blocks.some((b) => b.type === "text" && b.text === "Photo 2")).toBe(true);
    const last = blocks.at(-1) as Anthropic.Beta.BetaTextBlockParam;
    expect(last.cache_control).toEqual({ type: "ephemeral" });
    expect(last.text).toContain("eBay is not connected");
  });

  it("replays earlier turns as text, with the picks it showed", () => {
    const msgs = historyMessages([
      { role: "user", text: "jackets" },
      { role: "stylist", text: "Here you go.", picks: [{ title: "Chore coat", price: "$80", source: "eBay" }] },
      { role: "user", text: "  " },
    ]);
    expect(msgs).toHaveLength(2);
    expect((msgs[1].content as Anthropic.Beta.BetaTextBlockParam[])[0].text).toContain("1. Chore coat ($80, eBay)");
  });

  it("reads tool input defensively", () => {
    expect(toSearchInput({ searches: [{ query: "a", kind: "hats" }], board_photos: [0, 2, 1.5] })).toEqual({
      searches: [{ query: "a", shop_query: "a", kind: "clothing" }],
      use_attached_photo: false,
      board_photos: [2],
      min_price: null,
      max_price: null,
    });
  });

  it("keeps only picks it actually showed, in its order", () => {
    const shown = new Map([
      ["L1", listing("x")],
      ["L2", listing("y")],
    ]);
    const reply = toReply({ message: " Two good ones. ", picks: ["L2", "L9", " L1", "L2", 7], follow_ups: ["a", "", "b"] }, shown, "q");
    expect(reply).toEqual({ message: "Two good ones.", picks: [listing("y"), listing("x")], followUps: ["a", "b"], query: "q" });
  });

  it("searches, shows Claude the photos, and returns its picks", async () => {
    const requests: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
    const events: string[] = [];
    const deps: StylistDeps = {
      ebayConfigured: () => false,
      search: async () => ({ candidates: [{ listing: listing("a"), photo }, { listing: listing("b"), photo }], found: 2, problems: ["eBay failed"], summary: "Searched" }),
      create: async (params) => {
        requests.push(structuredClone(params));
        if (requests.length === 1) {
          return message(
            [
              { type: "thinking", thinking: "", signature: "s" } as Anthropic.Beta.BetaContentBlock,
              { type: "tool_use", id: "t1", name: "search_listings", input: { searches: [{ query: "chore coat", shop_query: "chore coat", kind: "clothing" }], use_attached_photo: false, board_photos: [], min_price: null, max_price: null } } as Anthropic.Beta.BetaContentBlock,
            ],
            "tool_use",
          );
        }
        return message([{ type: "text", text: JSON.stringify({ message: "Found one.", picks: ["L2"], follow_ups: ["More"] }) } as Anthropic.Beta.BetaContentBlock], "end_turn");
      },
    };
    const reply = await runStylist(input(), (e) => events.push(`${e.type}: ${e.text}`), undefined, deps);
    expect(reply.picks.map((p) => p.id)).toEqual(["b"]);
    expect(reply.query).toBe("chore coat");
    expect(events).toEqual(["status: Thinking", "status: Searching 20 shops for “chore coat”", "notice: eBay failed", "status: Looking through 2 listings"]);

    const [first, second] = requests;
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.fallbacks).toBe("default");
    expect(first.betas).toContain("server-side-fallback-2026-07-01");
    expect(first.output_config?.format?.type).toBe("json_schema");
    expect(JSON.stringify(first.output_config?.format)).not.toContain("why"); // no per-item writing
    expect(first.tool_choice).toBeUndefined();
    // The assistant turn goes back unchanged (thinking included), then the results with photos.
    expect(second.messages.at(-2)?.content).toHaveLength(2);
    const result = (second.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(result.type).toBe("tool_result");
    const content = result.content as Anthropic.Beta.BetaContentBlockParam[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content.some((b) => b.type === "text" && b.text.startsWith("L2 · Shop · Item b"))).toBe(true);
    const breakpoints = JSON.stringify(second).match(/cache_control/g) ?? [];
    expect(breakpoints.length).toBeLessThanOrEqual(4);
  });

  it("explains a refusal in plain words", async () => {
    const deps: StylistDeps = {
      ebayConfigured: () => false,
      search: async () => ({ candidates: [], found: 0, problems: [], summary: "" }),
      create: async () => message([], "refusal"),
    };
    await expect(runStylist(input(), () => {}, undefined, deps)).rejects.toThrow("couldn't help with that one");
  });
});
