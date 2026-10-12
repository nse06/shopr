import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "shopr-clicks-"));
process.env.SHOPR_LOCAL_BLOB_DIR = dir;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_STORE_ID;

// after() needs a live Next.js request; here it just runs the work and keeps the promise.
const later = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", () => ({ after: (work: () => unknown) => later.push(Promise.resolve(work())) }));

const { allowedDestination, tagged } = await import("@/lib/server/links");
const { clickSummary } = await import("@/lib/server/clicklog");
const { store } = await import("@/lib/server/storage");
const go = await import("@/app/go/route");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("where /go may send people", () => {
  it("allows the marketplaces and shops shopr searches, and nothing else", () => {
    for (const ok of [
      "https://www.ebay.com/itm/123",
      "https://www.ebay.co.uk/itm/123",
      "https://www.depop.com/products/seller-coat/",
      "https://denimdoctors.com/products/coat",
      "https://www.denimdoctors.com/products/coat",
      "https://www.grailed.com/shop?query=coat",
    ]) {
      expect(allowedDestination(ok), ok).not.toBeNull();
    }
    for (const bad of [
      "https://evil.example/login",
      "https://ebay.com.evil.example/itm/1",
      "https://notdenimdoctors.com/",
      "javascript:alert(1)",
      "https://user:pass@www.ebay.com/itm/1",
      "not a url",
    ]) {
      expect(allowedDestination(bad), bad).toBeNull();
    }
  });

  it("credits eBay referral links to the creator, and tells shops the visit came from shopr", () => {
    const ebay = new URL("https://www.ebay.com/itm/123?mkevt=1&mkcid=1&campid=5338000000&toolid=10049");
    expect(tagged(ebay, null).searchParams.get("customid")).toBe("shopr");
    expect(tagged(ebay, "maya.vintage").searchParams.get("customid")).toBe("shopr-via-maya_vintage");
    expect(tagged(new URL("https://www.ebay.com/itm/123"), "maya").toString()).toBe("https://www.ebay.com/itm/123"); // not a referral link
    const shop = tagged(new URL("https://denimdoctors.com/products/coat?variant=1"), "maya");
    expect(Object.fromEntries(shop.searchParams)).toEqual({ variant: "1", utm_source: "shopr", utm_medium: "referral", utm_campaign: "via-maya" });
    expect(tagged(new URL("https://www.depop.com/products/a/"), null).search).toBe("");
  });
});

describe("/go", () => {
  const request = (q: Record<string, string>) => new Request(`http://localhost/go?${new URLSearchParams(q)}`);

  it("counts the tap and sends the person on", async () => {
    const res = await go.GET(request({ u: "https://denimdoctors.com/products/coat", s: "Denim Doctors", t: "Chore coat", p: "120", v: "Maya.Vintage", w: "more" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://denimdoctors.com/products/coat?utm_source=shopr&utm_medium=referral&utm_campaign=via-maya_vintage");
    await go.GET(request({ u: "https://www.depop.com/products/a/", s: "Depop", t: "Fleece", w: "home" }));
    await go.GET(request({ u: "https://www.depop.com/products/b/", s: "Depop", v: "not a handle!", w: "nowhere" }));
    await Promise.all(later);

    const summary = await clickSummary(store());
    expect(summary.week.clicks).toBe(3);
    expect(summary.week.bySource).toEqual({ "Denim Doctors": 1, Depop: 2 });
    expect(summary.week.byCreator).toEqual({ "maya.vintage": 1 });
    expect(summary.recent[2]).toMatchObject({ source: "Denim Doctors", title: "Chore coat", priceUsd: 120, via: "maya.vintage", where: "more" });
    expect(summary.recent[0]).toMatchObject({ via: null, where: "home", priceUsd: null });
  });

  it("refuses to send anyone anywhere else", async () => {
    const res = await go.GET(request({ u: "https://evil.example/login", s: "eBay" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });
});
