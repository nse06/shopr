import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "shopr-drop-"));
process.env.SHOPR_LOCAL_BLOB_DIR = dir;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { dropSetup, fallbacksFor, kindOf, planSearches, profileSearches, rankDrop, runDrop, today } = await import("@/lib/server/drop");
const { judgeDrops, runOutcomes, saveOutcome, shuffle, testBoard } = await import("@/lib/server/droptest");
const { cachedDepop } = await import("@/lib/server/depop");
const { Meter } = await import("@/lib/server/costs");
const { store } = await import("@/lib/server/storage");
const { DropSchema, DropTestSchema } = await import("@/lib/server/schemas");
const { outcomeKey, reportText, sharedWithFull, summarize, TEST_SETUPS } = await import("@/lib/droptest");
const { dropBoardPhotos } = await import("@/lib/client/api");
const { DEFAULT_PREFS } = await import("@/lib/types");

import type { Deps } from "@/lib/server/search";
import type { BoardItem } from "@/lib/client/store";
import type { BoardResult } from "@/lib/droptest";
import type { Listing, StyleProfile } from "@/lib/types";

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Block = Anthropic.Beta.BetaContentBlockParam;

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

const profile = (over: Partial<StyleProfile> = {}): StyleProfile => ({
  headline: "Worn-in Americana",
  summary: "Faded workwear and old sweats.",
  directions: [
    { name: "Workwear", description: "Duck canvas.", photos: [1, 2] },
    { name: "Sportswear", description: "Heavy fleece.", photos: [3] },
  ],
  key_pieces: ["chore coat", "crewneck sweatshirt", "work boots"],
  palette: ["indigo", "brown"],
  fit: "Boxy on top.",
  look_for: ["Carhartt duck", "Champion Reverse Weave"],
  avoid: ["skinny fits"],
  searches: ["a", "b", "c", "d", "e", "f", "g"].map((q) => ({ query: `search ${q}`, shop_query: q, kind: "clothing" as const })),
  ...over,
});

// A real 600x800 JPEG, so the photo sizes each setup sees can be checked.
const jpeg = (await sharp({ create: { width: 600, height: 800, channels: 3, background: "#8a6f4d" } }).jpeg().toBuffer()).toString("base64");
const photo = { data: jpeg, mediaType: "image/jpeg" as const };
const longSide = async (b64: string) => {
  const m = await sharp(Buffer.from(b64, "base64")).metadata();
  return Math.max(m.width ?? 0, m.height ?? 0);
};

const blocks = (params: Params): Block[] => params.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
const texts = (params: Params) => blocks(params).flatMap((b) => (b.type === "text" ? [b.text] : []));
const images = (params: Params) => blocks(params).filter((b) => b.type === "image") as Anthropic.Beta.BetaImageBlockParam[];
const imageData = (b: Anthropic.Beta.BetaImageBlockParam) => (b.source as { data: string }).data;

const answer = (params: Params, body: unknown, usage = { input_tokens: 10_000, output_tokens: 1_000 }) =>
  ({ model: params.model, usage, content: [{ type: "text", text: JSON.stringify(body) }], stop_reason: "end_turn" }) as unknown as Anthropic.Beta.BetaMessage;

/** Shop results: ten listings for each search, from one shop. */
const deps = (over: Partial<Deps> = {}): Deps => ({
  ebayConfigured: () => false,
  depopConfigured: () => true,
  ebaySearch: async () => [],
  ebayImageSearch: async () => [],
  depopSearch: async (q, opts) => {
    opts.onScraped?.(2);
    return [listing(`depop-${q}`, { source: "Depop" })];
  },
  searchShop: async (shop, q) => (shop.domain.startsWith("denim") ? Array.from({ length: 10 }, (_, i) => listing(`${q}-${i + 1}`)) : []),
  fetchPhoto: async () => photo,
  ...over,
});

describe("planning a drop", () => {
  it("tells shoes and accessories from clothes", () => {
    expect(kindOf("Red Wing moc toe boots")).toBe("shoes");
    expect(kindOf("leather belt")).toBe("accessories");
    expect(kindOf("duck canvas chore coat")).toBe("clothing");
  });

  it("moves through the style read's searches day by day, and onwards for more", () => {
    const p = profile();
    const day = (d: number, round = 0) => planSearches(p, d, round).map((s) => s.query);
    expect(day(0)).toEqual(["search a", "search b", "search c"]);
    expect(day(1)).toEqual(["search d", "search e", "search f"]);
    expect(day(2)).toEqual(["search g", "search a", "search b"]); // wraps round
    expect(day(0, 1)).toEqual(day(1)); // "Find more" takes the next batch
  });

  it("makes searches from older reads that didn't write any", () => {
    const old = profile({ searches: undefined });
    expect(profileSearches(old).map((s) => [s.query, s.kind])).toEqual([
      ["Carhartt duck", "clothing"],
      ["vintage chore coat", "clothing"],
      ["Champion Reverse Weave", "clothing"],
      ["vintage crewneck sweatshirt", "clothing"],
      ["vintage work boots", "shoes"],
    ]);
    expect(planSearches(profile({ searches: [], look_for: [], key_pieces: [] }), 3)).toEqual([]);
  });

  it("has the style read write tidy searches for the drops", async () => {
    const { readBoard } = await import("@/lib/server/profile");
    const raw = {
      ...profile(),
      searches: [
        { query: "  carhartt duck chore coat ", shop_query: "chore coat", kind: "clothing" },
        { query: "red wing moc toe", shop_query: "", kind: "boots" },
        { query: " ", shop_query: "nothing", kind: "clothing" },
        ...Array.from({ length: 14 }, (_, i) => ({ query: `extra ${i}`, shop_query: "x", kind: "accessories" })),
      ],
    };
    const read = await readBoard([jpeg, jpeg, jpeg], DEFAULT_PREFS, {}, async (params) => answer(params, raw));
    expect(read.searches?.slice(0, 2)).toEqual([
      { query: "carhartt duck chore coat", shop_query: "chore coat", kind: "clothing" },
      { query: "red wing moc toe", shop_query: "red wing moc toe", kind: "clothing" }, // an unknown kind becomes clothing
    ]);
    expect(read.searches).toHaveLength(12); // the empty one is dropped, and 12 at most
  });

  it("runs on the stylist's model unless DROP_MODEL says otherwise", () => {
    expect(dropSetup()).toEqual({ model: "claude-opus-5-5", effort: "low", boardPhotos: 8, photoSide: 384, candidates: 20 });
    expect(dropSetup(9).candidates).toBe(20);
    expect(dropSetup(24).candidates).toBe(32);
    vi.stubEnv("DROP_MODEL", "claude-haiku-5-5");
    expect(dropSetup().model).toBe("claude-haiku-5-5");
    expect(fallbacksFor("claude-haiku-5-5")).toEqual({}); // Haiku has no server-side fallback
    expect(fallbacksFor("claude-sonnet-5-5")).toMatchObject({ fallbacks: "default" });
  });

  it("tests the same cheaper drop that runs for real", () => {
    const real = dropSetup();
    for (const id of ["opus", "sonnet", "haiku"]) {
      const { effort, boardPhotos, photoSide, candidates } = TEST_SETUPS.find((s) => s.id === id)!;
      expect({ effort, boardPhotos, photoSide, candidates }).toEqual({ effort: real.effort, boardPhotos: real.boardPhotos, photoSide: real.photoSide, candidates: real.candidates });
    }
  });
});

describe("ranking a drop", () => {
  const candidates = Array.from({ length: 12 }, (_, i) => ({ listing: listing(`c${i + 1}`), photo }));

  it("asks once, with the style read, the board and every candidate, and maps ids back to listings", async () => {
    const calls: Params[] = [];
    const meter = new Meter();
    const ranked = await rankDrop({
      profile: profile(),
      board: [photo, photo],
      candidates,
      prefs: DEFAULT_PREFS,
      passed: [{ title: "Logo tee", source: "eBay" }],
      size: 3,
      setup: { model: "claude-haiku-5-5", effort: "low" },
      meter,
      create: async (params) => {
        calls.push(params);
        return answer(params, { picks: ["L4", "L99", "L4", " L2", "L7", "L1"], note: "Leans into faded canvas." });
      },
    });
    expect(ranked.picks.map((l) => l.id)).toEqual(["c4", "c2", "c7"]); // unknown and repeated ids skipped, capped at 3
    expect(ranked.note).toBe("Leans into faded canvas.");
    const [params] = calls;
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.output_config).toMatchObject({ effort: "low" });
    expect(params).not.toHaveProperty("fallbacks");
    expect(images(params)).toHaveLength(2 + 12);
    expect(texts(params).filter((t) => /^L\d+ · /.test(t))).toHaveLength(12);
    expect(texts(params).join("\n")).toContain("Not for me");
    expect(meter.claude.calls).toBe(1);
    expect(meter.claude.usd).toBeCloseTo((10_000 * 0.1 + 1_000 * 0.5) / 1e6, 10);
  });

  it("puts the board in, then picks from today's searches, skipping what's been seen", async () => {
    const calls: Params[] = [];
    const depopQueries: string[] = [];
    const meter = new Meter();
    const seen = `${planSearches(profile(), today())[0].shop_query}-1`; // a shop listing from today's first search
    const result = await runDrop(
      { profile: profile(), board: Array(10).fill(jpeg), prefs: DEFAULT_PREFS, seen: [seen], passed: [], size: 9, round: 0 },
      {
        meter,
        deps: deps({
          depopSearch: async (q, opts) => {
            depopQueries.push(q);
            opts.onScraped?.(1);
            return [listing(`depop-${q}`, { source: "Depop" })];
          },
        }),
        create: async (params) => {
          calls.push(params);
          return answer(params, { picks: ["L1", "L2", "L3"], note: "Canvas first." });
        },
      },
    );
    expect(depopQueries).toHaveLength(1); // Depop for the first search only
    expect(result.picks).toHaveLength(3);
    expect(result.query).toBe(depopQueries[0]);
    const [params] = calls;
    const lines = texts(params).filter((t) => /^L\d+ · /.test(t));
    expect(lines).toHaveLength(20);
    expect(lines.some((t) => t.includes(` · Item ${seen} · `))).toBe(false); // seen before
    expect(lines.some((t) => t.includes(` · Item ${seen.replace(/-1$/, "-2")} · `))).toBe(true);
    expect(images(params)).toHaveLength(8 + 20);
    expect(await longSide(imageData(images(params)[0]))).toBe(384);
    expect(meter.depop.runs).toBe(1);
  });

  it("doesn't call Claude when nothing turned up", async () => {
    const create = vi.fn();
    const result = await runDrop(
      { profile: profile(), board: [], prefs: DEFAULT_PREFS, seen: [], passed: [], size: 9, round: 0 },
      { deps: deps({ depopConfigured: () => false, searchShop: async () => [] }), create },
    );
    expect(result.picks).toEqual([]);
    expect(result.note).toMatch(/Nothing new/);
    expect(create).not.toHaveBeenCalled();
  });

  it("takes requests the server can check", () => {
    expect(DropSchema.safeParse({ profile: profile() }).success).toBe(true);
    expect(DropSchema.safeParse({ profile: profile(), board: Array(9).fill(jpeg) }).success).toBe(false); // 8 board photos at most
    const test = { run: "abc123xyz", board: "own", own: { profile: profile(), board: [jpeg, jpeg, jpeg] } };
    expect(DropTestSchema.parse(test).attempt).toBe(1);
    expect(DropTestSchema.safeParse({ ...test, run: "../x" }).success).toBe(false);
  });
});

describe("the Depop cache", () => {
  it("pays for each search once a day", async () => {
    const search = vi.fn(async () => [listing("depop-1", { source: "Depop" })]);
    const cached = cachedDepop(search, () => store());
    const first = await cached("Chore coat", { department: "any" });
    const again = await cached("chore coat ", { department: "any" });
    expect(again).toEqual(first);
    expect(search).toHaveBeenCalledTimes(1);
    await cached("chore coat", { department: "men" }); // another department is another search
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe("the board photos a drop sends", () => {
  it("starts with one photo from each direction, then the newest", () => {
    const item = (id: string, addedAt: number) => ({ id, ai: `ai-${id}`, addedAt }) as BoardItem;
    const board = ["a", "b", "c", "d", "e"].map((id, i) => item(id, i));
    const record = { profile: profile(), boardKey: "a,b,c,d,e", at: 0 }; // directions: photos 1, 2 and 3
    expect(dropBoardPhotos(board, record, 4)).toEqual(["ai-a", "ai-c", "ai-b", "ai-e"]);
    expect(dropBoardPhotos(board, null, 2)).toEqual(["ai-e", "ai-d"]);
  });
});

describe("the drop test", () => {
  // Each setup picks differently: Opus picks L1-L9, Sonnet L2-L10 and Haiku L12-L20.
  const firstPick: Record<string, number> = { "claude-opus-5-5": 1, "claude-sonnet-5-5": 2, "claude-haiku-5-5": 12 };
  // The judge likes the first nine listings shown and nothing else.
  const liked = new Set<string>();

  function fakeClaude(calls: Params[]) {
    return async (params: Params) => {
      calls.push(params);
      const t = texts(params);
      if (String(params.system).includes("senior stylist")) {
        const sets: { set: string; score: number; why: string }[] = [];
        for (const line of t) {
          const head = line.match(/^Set ([A-Z]) \(/);
          if (head) sets.push({ set: `Set ${head[1]}`, score: 0, why: "fine" });
          else if (/^[A-Z]\d+ · /.test(line) && [...liked].some((title) => line.includes(` · ${title} ·`))) sets.at(-1)!.score++;
        }
        return answer(params, { sets: sets.map((s) => ({ ...s, score: s.score + 1 })) }, { input_tokens: 20_000, output_tokens: 2_000 });
      }
      const ids = t.flatMap((line) => line.match(/^(L\d+) · /)?.[1] ?? []);
      if (!liked.size) for (const line of t.filter((x) => /^L\d+ · /.test(x)).slice(0, 9)) liked.add(line.split(" · ")[2]);
      const from = firstPick[params.model];
      return answer(params, { picks: ids.slice(from - 1, from + 8), note: "A note." });
    };
  }

  it("lets every setup pick from the same listings, then scores them blind", async () => {
    const calls: Params[] = [];
    const meter = new Meter();
    const result = await testBoard(
      { board: { id: "own", title: "Your board" }, photos: Array(10).fill(photo), profile: profile(), prefs: DEFAULT_PREFS, readUsd: 0.05 },
      { meter, deps: deps(), create: fakeClaude(calls), random: () => 0.3 },
    );

    const ranks = calls.filter((c) => !String(c.system).includes("senior stylist"));
    const judge = calls.find((c) => String(c.system).includes("senior stylist"))!;
    expect(ranks.map((c) => [c.model, c.output_config?.effort])).toEqual([
      ["claude-opus-5-5", "medium"],
      ["claude-opus-5-5", "low"],
      ["claude-sonnet-5-5", "low"],
      ["claude-haiku-5-5", "low"],
    ]);
    // Full detail sees all ten board photos and 24 listings at 512px; the cheaper drops 8 and 20 at 384px.
    expect(ranks.map((c) => images(c).length)).toEqual([10 + 24, 8 + 20, 8 + 20, 8 + 20]);
    expect(await longSide(imageData(images(ranks[0])[0]))).toBe(800); // as sent: the browser and fetchPhoto already keep them to 512
    expect(await longSide(imageData(images(ranks[1])[0]))).toBe(384);
    expect(await longSide(imageData(images(ranks[1]).at(-1)!))).toBe(384);
    // The same listings, in the same order, for everyone.
    const listingLines = (c: Params) => texts(c).filter((x) => /^L\d+ · /.test(x));
    expect(listingLines(ranks[1])).toEqual(listingLines(ranks[0]).slice(0, 20));
    expect(listingLines(ranks[3])).toEqual(listingLines(ranks[1]));

    expect(judge.model).toBe("claude-opus-5-5");
    expect(texts(judge).filter((x) => /^Set [A-D] \(9 pieces\):$/.test(x))).toHaveLength(4);

    const by = Object.fromEntries(result.setups.map((s) => [s.setup, s]));
    expect(by.full.score).toBe(10);
    expect(by.opus.score).toBe(10);
    expect(by.sonnet.score).toBe(9); // eight of the nine it liked
    expect(by.haiku.score).toBe(1);
    expect(sharedWithFull(result, "sonnet")).toBe(8);
    expect(sharedWithFull(result, "haiku")).toBe(0);
    expect(by.haiku.usd).toBeCloseTo((10_000 * 0.1 + 1_000 * 0.5) / 1e6, 10);
    expect(by.opus.usd).toBeCloseTo((10_000 * 4 + 1_000 * 20) / 1e6, 10);
    expect(result).toMatchObject({ board: "own", headline: "Worn-in Americana", candidates: 24, readUsd: 0.05, depopUsd: expect.any(Number) });
    expect(result.judgeUsd).toBeCloseTo((20_000 * 4 + 2_000 * 20) / 1e6, 10);
    expect(meter.claude.calls).toBe(5);
    expect(meter.depop.runs).toBe(1);
  });

  it("reads the judge's letters back to the right setups, whatever the order", async () => {
    const sets = ["full", "opus", "sonnet", "haiku"].map((id, i) => ({ id, picks: [{ listing: listing(`p${i}`), photo }] }));
    for (const seed of [0, 0.4, 0.9]) {
      const order = shuffle(sets, () => seed).map((s) => s.id);
      const verdicts = await judgeDrops({
        profile: profile(),
        board: [photo],
        sets,
        random: () => seed,
        create: async (params) =>
          answer(params, { sets: order.map((id, i) => ({ set: i === 0 ? "set A" : String.fromCharCode(65 + i), score: id === "haiku" ? 14 : 7, why: id })) }),
      });
      expect(Object.fromEntries(verdicts)).toEqual({
        full: { score: 7, why: "full" },
        opus: { score: 7, why: "opus" },
        sonnet: { score: 7, why: "sonnet" },
        haiku: { score: 10, why: "haiku" }, // kept within 1 to 10
      });
    }
  });

  it("keeps each board's result for the page to collect", async () => {
    const s = store();
    const failure = { board: "western", title: "70s western", error: "Claude is busy.", at: 1 };
    await saveOutcome(s, "run123abc", 1, failure);
    await saveOutcome(s, "run123abc", 2, { ...failure, error: "Still busy." });
    const saved = await runOutcomes(s, "run123abc");
    expect(saved[outcomeKey("western", 1)]).toMatchObject({ error: "Claude is busy." });
    expect(saved[outcomeKey("western", 2)]).toMatchObject({ error: "Still busy." });
    expect(await runOutcomes(s, "nothing00")).toEqual({});
  });

  it("sums the results up, and writes them out for Claude", () => {
    const setup = (id: string, score: number | null, usd: number, picks: string[]) => ({
      setup: id,
      picks: picks.map((p) => ({ id: p, title: `Item ${p}`, price: "$50", source: "Shop", thumb: "" })),
      note: "",
      usd,
      ms: 20_000,
      tokensIn: 9000,
      tokensOut: 800,
      score,
      why: `${id} why`,
    });
    const board = (name: string, haiku: number): BoardResult => ({
      board: name,
      title: name,
      headline: "Headline",
      searches: ["a", "b"],
      candidates: 24,
      setups: [setup("full", 8, 0.12, ["1", "2", "3"]), setup("opus", 8, 0.05, ["1", "2", "4"]), setup("sonnet", 7, 0.03, ["5"]), setup("haiku", haiku, 0.001, [])],
      judgeUsd: 0.09,
      readUsd: 0,
      depopUsd: 0.05,
      problems: [],
      at: 1,
    });
    const results = [board("one", 2), board("two", 4)];
    const summary = Object.fromEntries(summarize(results).map((s) => [s.setup.id, s]));
    expect(summary.full).toMatchObject({ boards: 2, score: 8, usd: 0.12, shared: null, best: 2 });
    expect(summary.opus).toMatchObject({ score: 8, shared: 2, best: 2 });
    expect(summary.sonnet).toMatchObject({ score: 7, shared: 0, best: 0 });
    expect(summary.haiku.score).toBe(3);

    const text = reportText([...results, { board: "three", title: "three", error: "It took too long.", at: 2 }], "2026-10-12");
    expect(text).toContain("shopr drop test, 2026-10-12: 2 boards done");
    expect(text).toContain("- Opus 5.5, cheaper drop: score 8.0/10, Claude 5.0¢, 20s, best on 2 of 2, 2.0 picks in common with full detail");
    expect(text).toContain("  haiku: 2/10, 0.10¢, 20s, 9000 in / 800 out, 0 shared. haiku why");
    expect(text).toContain("    picks: Item 1 ($50) | Item 2 ($50) | Item 4 ($50)");
    expect(text).toContain("three: failed (It took too long.)");
  });
});
