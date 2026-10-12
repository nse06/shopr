import { describe, expect, it } from "vitest";
import { BOARD_W, bottom, clamp, frameHeight, GAP, pinnedOrder, place, readingOrder, tidy, tilt } from "@/lib/board-layout";
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
  const column = (it: { x: number; w: number }, columns = 4) => Math.floor((it.x + it.w / 2) / (BOARD_W / columns));

  it("frames photos like polaroids, with a deeper bottom edge", () => {
    expect(frameHeight(216, 1.25)).toBe(284);
  });

  it("drops a new photo at the top of the shortest column, a little off-centre and tilted", () => {
    const a = place([], 4, "a");
    expect(column(a)).toBe(0);
    expect(a.y).toBeGreaterThanOrEqual(GAP);
    expect(a.y).toBeLessThanOrEqual(GAP + 12);
    expect(a.w).toBeGreaterThan(190);
    expect(a.w).toBeLessThan(240);
    expect(Math.abs(a.rot)).toBeLessThanOrEqual(4);
    expect(place([], 4, "a")).toEqual(a); // the same photo always lands the same way

    const first = ["a", "b", "c", "d"].map((id, i) => ({ id, z: 1, aspect: i === 2 ? 0.5 : 1.3, ...place([], 4, id), x: i * 250 + 20 }));
    expect(column(place(first.slice(0, 1), 4, "e"))).toBe(1);
    expect(column(place(first, 4, "e"))).toBe(2); // the column with the wide photo is shortest
    expect(column(place([], 2, "a"), 2)).toBe(0);
  });

  it("tidies into columns, keeps each photo's tilt, and leaves a tidy board alone", () => {
    const messy = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id, i) => ({
      id,
      x: (i * 137) % 800,
      y: (i * 211) % 900,
      w: 150 + i * 20,
      aspect: 0.8 + (i % 3) * 0.3,
      z: i,
      rot: i - 4,
    }));
    const once = tidy(messy, 4);
    expect(new Map(once.map((i) => [i.id, i.rot]))).toEqual(new Map(messy.map((i) => [i.id, i.rot])));
    expect(tidy(once, 4)).toEqual(once);
    for (let c = 0; c < 4; c++) {
      const stack = once.filter((i) => column(i) === c).sort((p, q) => p.y - q.y);
      for (let k = 1; k < stack.length; k++) expect(stack[k].y).toBeGreaterThanOrEqual(bottom(stack[k - 1]));
    }
  });

  it("knows the order photos were pinned in, and reads a board top to bottom", () => {
    let board: { id: string; x: number; y: number; w: number; aspect: number; z: number }[] = [];
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) board = [...board, { id, aspect: id === "p2" ? 1.6 : 1.1, z: 1, ...place(board, 4, id) }];
    expect(pinnedOrder([...board].reverse()).map((i) => i.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
    const row = (id: string, x: number, y: number) => ({ id, x, y, w: 200, aspect: 1, z: 1 });
    expect(readingOrder([row("c", 500, 25), row("d", 0, 400), row("a", 10, 20), row("b", 260, 30)]).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("gives photos pinned before tilts existed a steady tilt, and keeps photos on the board", () => {
    expect(tilt({ id: "old" })).toBe(tilt({ id: "old" }));
    expect(Math.abs(tilt({ id: "old" }))).toBeLessThanOrEqual(4);
    expect(tilt({ id: "x", rot: 2.5 })).toBe(2.5);
    expect(clamp({ x: 900, y: -20, w: 300 })).toEqual({ x: 700, y: 0, w: 300 });
    expect(clamp({ x: 0, y: 0, w: 20 })).toEqual({ x: 0, y: 0, w: 110 });
  });
});
