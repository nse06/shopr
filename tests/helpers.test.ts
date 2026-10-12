import { describe, expect, it } from "vitest";
import { boardHeight, clamp, place, tidy } from "@/lib/board-layout";
import { isPublicUrl, previewImageFromHtml, sniffImage } from "@/lib/server/fetching";

describe("links", () => {
  it("only fetches public web addresses", () => {
    expect(isPublicUrl("https://www.pinterest.com/pin/1/")).not.toBeNull();
    for (const bad of [
      "file:///etc/passwd",
      "http://localhost:3000",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://192.168.1.20:8000/",
      "http://172.20.10.3/",
      "http://169.254.169.254/latest",
      "http://[::1]/",
      "http://intranet/",
      "https://user:pass@example.com/",
      "not a url",
    ]) {
      expect(isPublicUrl(bad), bad).toBeNull();
    }
  });

  it("finds the photo a page shares", () => {
    const html = `<html><head><meta content="/img/pin.jpg" property="og:image"><meta name="twitter:image" content="https://x.example/t.jpg"></head></html>`;
    expect(previewImageFromHtml(html, "https://www.pinterest.com/pin/1/")).toBe("https://www.pinterest.com/img/pin.jpg");
    expect(previewImageFromHtml("<html></html>", "https://a.example/")).toBeNull();
  });

  it("recognises photo formats by their bytes", () => {
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<html>hello</html>"))).toBeNull();
  });
});

describe("moodboard layout", () => {
  const item = (id: string, x: number, y: number, w = 300, aspect = 1) => ({ id, x, y, w, aspect, z: 1 });

  it("puts a new photo at the top of the shortest column", () => {
    // Three 300-wide columns with 16 between them, centred: x = 34, 350, 666.
    expect(place([], 300)).toEqual({ x: 34, y: 0 });
    expect(place([item("a", 34, 0), item("b", 350, 0, 300, 2)], 300)).toEqual({ x: 666, y: 0 });
    expect(place([item("a", 34, 0), item("b", 350, 0), item("c", 666, 0, 300, 0.5)], 300)).toEqual({ x: 666, y: 166 });
  });

  it("tidies into columns and keeps photos on the board", () => {
    const out = tidy([item("a", 500, 40), item("b", 0, 900), item("c", 10, 10)], 470);
    expect(out.map((i) => [i.id, i.x, i.y])).toEqual([
      ["c", 22, 0],
      ["a", 508, 0],
      ["b", 22, 486],
    ]);
    expect(boardHeight(out)).toBe(956);
    expect(clamp({ x: 900, y: -20, w: 300 })).toEqual({ x: 700, y: 0, w: 300 });
    expect(clamp({ x: 0, y: 0, w: 20 })).toEqual({ x: 0, y: 0, w: 120 });
  });
});
