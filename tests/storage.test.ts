import { afterEach, describe, expect, it, vi } from "vitest";

const head = vi.fn();
vi.mock("@vercel/blob", async (original) => ({ ...(await original<typeof import("@vercel/blob")>()), head: (...args: unknown[]) => head(...args) }));

const { BlobNotFoundError } = await import("@vercel/blob");
const { BlobStore } = await import("@/lib/server/storage");

const URL_ = "https://abc123.public.blob.vercel-storage.com/index.json";

describe("reading shared boards from Vercel Blob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    head.mockReset();
  });

  it("fetches exactly the latest version, waiting out an older copy in the CDN", async () => {
    head.mockResolvedValue({ url: URL_, etag: '"v2"' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ boards: ["old"] }, { headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(Response.json({ boards: ["new"] }, { headers: { etag: '"v2"' } }));
    vi.stubGlobal("fetch", fetchMock);
    const read = await new BlobStore().readJson<{ boards: string[] }>("index.json");
    expect(read).toEqual({ data: { boards: ["new"] }, etag: '"v2"' });
    expect(head).toHaveBeenCalledWith("index.json");
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls[0]).toBe(`${URL_}?v=v2`); // a new address for each version skips the stale copy
    expect(urls[1]).toBe(`${URL_}?v=v2.1`);
  });

  it("says a file isn't there when the Blob API says so", async () => {
    head.mockRejectedValue(new BlobNotFoundError());
    vi.stubGlobal("fetch", vi.fn());
    expect(await new BlobStore().readJson("owners/nobody.json")).toBeNull();
  });

  it("knows its own photo addresses", () => {
    const s = new BlobStore();
    expect(s.owns("https://abc123.public.blob.vercel-storage.com/boards/maya/photos/a.jpg", "boards/maya/photos/")).toBe(true);
    expect(s.owns("https://abc123.public.blob.vercel-storage.com/boards/other/photos/a.jpg", "boards/maya/photos/")).toBe(false);
    expect(s.owns("https://evil.example/boards/maya/photos/a.jpg", "boards/maya/photos/")).toBe(false);
    expect(s.owns("http://abc123.public.blob.vercel-storage.com/boards/maya/photos/a.jpg", "boards/maya/photos/")).toBe(false);
  });
});
