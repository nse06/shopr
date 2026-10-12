import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "shopr-costs-"));
process.env.SHOPR_LOCAL_BLOB_DIR = dir;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

const { Meter, priceFor } = await import("@/lib/server/costs");
const { costSummary, logCost, recordCost } = await import("@/lib/server/costlog");
const { store } = await import("@/lib/server/storage");
const { runSearch } = await import("@/lib/server/search");
const { DEFAULT_PREFS } = await import("@/lib/types");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) =>
  ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite }) as never;

describe("what a request costs", () => {
  it("prices Claude by the model that answered", () => {
    const m = new Meter();
    m.claudeUsed({ model: "claude-opus-5-5", usage: usage(10_000, 2_000, 5_000, 3_000) });
    // $4/M in, $20/M out, $0.20/M cache reads, $5/M cache writes
    expect(m.claude.usd).toBeCloseTo((10_000 * 4 + 2_000 * 20 + 5_000 * 0.2 + 3_000 * 5) / 1e6, 10);
    m.claudeUsed({ model: "claude-sonnet-5-5", usage: usage(1_000_000, 0) });
    expect(m.claude.calls).toBe(2);
    expect(m.claude.usd).toBeCloseTo(0.096 + 2, 10);
    expect(priceFor("claude-opus-5").input).toBe(5);
    expect(priceFor("claude-opus-5-5").input).toBe(4); // the longest matching name wins
    expect(priceFor("claude-something-new").input).toBe(4); // unknown: priced like the stylist's model
  });

  it("prices Depop by the listings Apify returned", () => {
    const m = new Meter();
    m.depopRun(10);
    m.depopRun(0);
    expect(m.depop).toEqual({ runs: 2, listings: 10, usd: expect.closeTo(0.0004 + 0.05, 10) });
    expect(m.usd).toBeCloseTo(0.0504, 10);
  });

  it("counts every Depop run in a search, including ones that fail", async () => {
    const photo = { data: "/9j/", mediaType: "image/jpeg" as const };
    const deps = {
      ebayConfigured: () => false,
      depopConfigured: () => true,
      ebaySearch: async () => [],
      ebayImageSearch: async () => [],
      depopSearch: async (q: string, opts: { onScraped?: (n: number) => void }) => {
        if (q === "b") throw new Error("Depop was slow to answer this time.");
        opts.onScraped?.(10);
        return [];
      },
      searchShop: async () => [],
      fetchPhoto: async () => photo,
    };
    const meter = new Meter();
    const input = { searches: ["a", "b"].map((q) => ({ query: q, shop_query: q, kind: "clothing" as const })), use_attached_photo: false, board_photos: [], min_price: null, max_price: null };
    await runSearch(input, { prefs: DEFAULT_PREFS, seen: new Set(), photo: null, board: [], meter }, deps as never);
    expect(meter.depop.runs).toBe(2);
    expect(meter.depop.listings).toBe(10);
  });
});

describe("the cost log", () => {
  const DAY = 86_400_000;
  const now = Date.parse("2026-10-12T15:00:00Z");
  const spent = (claudeUsd: number, listings = 0) => {
    const m = new Meter();
    m.claudeUsed({ model: "claude-opus-5-5", usage: usage(Math.round(claudeUsd * 250_000), 0) }); // $4/M
    if (listings) m.depopRun(listings);
    m.ok = true;
    return m;
  };

  it("keeps totals per day and the latest requests", async () => {
    const s = store();
    await recordCost(s, spent(0.2, 20), "picks", now - 2 * 3_600_000);
    await recordCost(s, spent(0.1), "read", now - 3_600_000);
    await recordCost(s, spent(0.25, 20), "chat", now);
    await recordCost(s, spent(0.3, 20), "picks", now - 10 * DAY);
    await recordCost(s, spent(0.3, 20), "picks", now - 40 * DAY); // too old to count

    const summary = await costSummary(s, now);
    expect(summary.week.requests).toBe(3);
    expect(summary.month.requests).toBe(4);
    expect(summary.week.byKind.picks).toEqual({ n: 1, claudeUsd: 0.2, depopUsd: expect.closeTo(0.1002, 6) });
    expect(summary.month.byKind.picks?.n).toBe(2);
    expect(summary.week.usd).toBeCloseTo(0.2 + 0.1002 + 0.1 + 0.25 + 0.1002, 4);
    expect(summary.recent.map((e) => e.kind)).toEqual(["chat", "read", "picks", "picks", "picks"]);
    expect(summary.recent[0]).toMatchObject({ at: now, ok: true, claudeUsd: 0.25 });
  });

  it("logs nothing for a request that spent nothing, and never throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await logCost(new Meter(), "chat");
    expect(log).not.toHaveBeenCalled();
    await logCost(spent(0.1), "chat");
    expect(log).toHaveBeenCalledWith("cost", expect.stringContaining('"kind":"chat"'));
    log.mockRestore();
  });
});
