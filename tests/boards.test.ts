import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Public boards are kept in a local folder here, the way `npm run dev` can.
const dir = mkdtempSync(path.join(tmpdir(), "shopr-boards-"));
process.env.SHOPR_LOCAL_BLOB_DIR = dir;
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.APP_PASSWORD;

const boards = await import("@/app/api/boards/route");
const board = await import("@/app/api/boards/[handle]/route");
const photos = await import("@/app/api/boards/[handle]/photos/route");
const localBlob = await import("@/app/api/local-blob/[...path]/route");
const { normalizeHandle } = await import("@/lib/server/boards");

const KEY = "k".repeat(43);
const OTHER = "o".repeat(43);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const ctx = (handle: string) => ({ params: Promise.resolve({ handle }) });

function req(url: string, init: { method?: string; key?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (init.key) headers.set("x-owner-key", init.key);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const claim = (handle: string, key = KEY) => boards.POST(req("/api/boards", { method: "POST", key, body: { handle } }));
const upload = (handle: string, id: string, key = KEY, bytes: Uint8Array<ArrayBuffer> = JPEG) =>
  photos.POST(req(`/api/boards/${handle}/photos?id=${id}`, { method: "POST", key, raw: new Blob([bytes]) }), ctx(handle));
const put = (handle: string, body: unknown, key = KEY) => board.PUT(req(`/api/boards/${handle}`, { method: "PUT", key, body }), ctx(handle));
const search = async (q: string) => ((await (await boards.GET(req(`/api/boards?q=${encodeURIComponent(q)}`))).json()) as { boards: { handle: string }[] }).boards.map((b) => b.handle);

const photo = (id: string, url: string, y = 18) => ({ id, url, aspect: 1.25, x: 20, y, w: 215, rot: -2.5, z: 1 });
const profile = {
  headline: "Faded workwear and 70s suede",
  summary: "Mostly worn-in workwear.",
  directions: [{ name: "Workwear", description: "Chore coats.", photos: [1] }],
  key_pieces: ["chore coat"],
  palette: ["indigo", "tan"],
  fit: "Boxy",
  look_for: ["duck canvas"],
  avoid: ["logos"],
};

afterEach(() => vi.unstubAllEnvs());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("handles", () => {
  it("accepts simple handles only", () => {
    expect(normalizeHandle("@Maya.Vintage")).toBe("maya.vintage");
    for (const bad of ["a", "has space", "dot.", ".dot", "explore", "x".repeat(25)]) expect(normalizeHandle(bad), bad).toBeNull();
  });

  it("goes to the first device to claim it", async () => {
    expect(await (await claim("@Maya.Vintage")).json()).toEqual({ handle: "maya.vintage", status: "created" });
    expect(await (await claim("maya.vintage")).json()).toEqual({ handle: "maya.vintage", status: "yours" });
    expect((await claim("maya.vintage", OTHER)).status).toBe(409);
    expect((await claim("explore")).status).toBe(409);
    expect((await claim("a")).status).toBe(400);
    expect((await boards.POST(req("/api/boards", { method: "POST", body: { handle: "nokey" } }))).status).toBe(400);
  });
});

describe("public boards", () => {
  it("publishes a board that anyone can see and find", async () => {
    await claim("maya.vintage");
    const up = await upload("maya.vintage", "photo-1");
    const { url } = (await up.json()) as { url: string };
    expect(url).toBe("/api/local-blob/boards/maya.vintage/photos/photo-1.jpg");
    expect((await upload("maya.vintage", "photo-x", OTHER)).status).toBe(403);
    expect((await upload("maya.vintage", "photo-x", KEY, new TextEncoder().encode("<html>not a photo</html>"))).status).toBe(400);

    const body = { name: "Maya", bio: "Chore coats forever", link: "https://instagram.com/maya", photos: [photo("photo-1", url)], profile };
    expect((await put("maya.vintage", body, OTHER)).status).toBe(403);
    expect((await put("maya.vintage", { ...body, photos: [photo("photo-1", "https://elsewhere.example/a.jpg")] })).status).toBe(400);
    expect((await put("maya.vintage", { ...body, link: "javascript:alert(1)" })).status).toBe(400);
    expect((await put("maya.vintage", { ...body, photos: [photo("photo-1", url), photo("photo-1", url)] })).status).toBe(400);
    const saved = await put("maya.vintage", body);
    expect(saved.status).toBe(200);

    const seen = (await (await board.GET(req("/api/boards/maya.vintage"), ctx("Maya.Vintage"))).json()) as { board: { name: string; photos: unknown[] } };
    expect(seen.board.name).toBe("Maya");
    expect(seen.board.photos).toEqual([photo("photo-1", url)]);
    expect((await board.GET(req("/api/boards/nobody"), ctx("nobody"))).status).toBe(404);

    const file = await localBlob.GET(req(url), { params: Promise.resolve({ path: url.split("/").slice(3) }) });
    expect(file.headers.get("content-type")).toBe("image/jpeg");

    expect(await search("maya")).toEqual(["maya.vintage"]);
    expect(await search("workwear indigo")).toEqual(["maya.vintage"]); // words from its style read
    expect(await search("sequins")).toEqual([]);
  });

  it("ranks name matches first, then the newest", async () => {
    await claim("workwear.club", OTHER);
    const { url } = (await (await upload("workwear.club", "photo-9", OTHER)).json()) as { url: string };
    await put("workwear.club", { name: "Workwear Club", bio: "", link: null, photos: [photo("photo-9", url)], profile: null }, OTHER);
    expect(await search("workwear")).toEqual(["workwear.club", "maya.vintage"]);
    expect(await search("")).toEqual(["workwear.club", "maya.vintage"]);
  });

  it("deletes photos a board stops using, and boards that are taken down", async () => {
    const { url } = (await (await upload("maya.vintage", "photo-2")).json()) as { url: string };
    await put("maya.vintage", { name: "Maya", bio: "", link: null, photos: [photo("photo-2", url)], profile: null });
    const old = "/api/local-blob/boards/maya.vintage/photos/photo-1.jpg";
    expect((await localBlob.GET(req(old), { params: Promise.resolve({ path: old.split("/").slice(3) }) })).status).toBe(404);

    expect((await board.DELETE(req("/api/boards/maya.vintage", { method: "DELETE", key: OTHER }), ctx("maya.vintage"))).status).toBe(403);
    expect((await board.DELETE(req("/api/boards/maya.vintage", { method: "DELETE", key: KEY }), ctx("maya.vintage"))).status).toBe(200);
    expect((await board.GET(req("/api/boards/maya.vintage"), ctx("maya.vintage"))).status).toBe(404);
    expect(await search("maya")).toEqual([]);
    expect(await (await claim("maya.vintage", OTHER)).json()).toEqual({ handle: "maya.vintage", status: "created" }); // the handle is free again
  });

  it("lets anyone look when the app is locked, but only the password holder change things", async () => {
    vi.stubEnv("APP_PASSWORD", "secret");
    expect((await claim("someone.new")).status).toBe(401);
    expect((await boards.GET(req("/api/boards?q="))).status).toBe(200);
    expect((await board.GET(req("/api/boards/workwear.club"), ctx("workwear.club"))).status).toBe(200);
  });

  it("recognises a Blob store connected the newer way, and explains a private one", async () => {
    const { storageConfigured } = await import("@/lib/server/storage");
    const { storageProblem } = await import("@/lib/server/sharing");
    vi.stubEnv("SHOPR_LOCAL_BLOB_DIR", "");
    vi.stubEnv("BLOB_STORE_ID", "store_abc123");
    expect(storageConfigured()).toBe(true);
    expect(storageProblem(new Error("Vercel Blob: Cannot use public access on a private store"))).toContain("public one");
    expect(storageProblem(new Error("socket hang up"))).toBe("Couldn't reach the shared boards just now. Try again.");
  });

  it("explains how to switch sharing on when there's nowhere to keep boards", async () => {
    vi.stubEnv("SHOPR_LOCAL_BLOB_DIR", "");
    const res = await boards.GET(req("/api/boards?q="));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toContain("Blob store");
  });
});
