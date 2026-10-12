import { describe, expect, it } from "vitest";
import { photosToShare, renumber, shareSignature } from "@/lib/client/sharing";
import type { BoardItem } from "@/lib/client/store";
import type { StyleProfile } from "@/lib/types";

const item = (id: string, x: number, y: number, extra: Partial<BoardItem> = {}): BoardItem => ({
  id,
  image: "data:image/jpeg;base64,/9j/",
  ai: "/9j/",
  aspect: 1,
  x,
  y,
  w: 215,
  z: 1,
  rot: 1,
  addedAt: 0,
  ...extra,
});

const read: StyleProfile = {
  headline: "Workwear",
  summary: "",
  directions: [
    { name: "Chore coats", description: "", photos: [1, 3] },
    { name: "Loafers", description: "", photos: [2] },
  ],
  key_pieces: [],
  palette: [],
  fit: "",
  look_for: [],
  avoid: [],
};

describe("sharing a board", () => {
  it("renumbers a style read's photos for another order, dropping photos that aren't there", () => {
    const out = renumber(read, ["a", "b", "c"], ["c", "a"]);
    expect(out.directions.map((d) => d.photos)).toEqual([[2, 1], []]);
    expect(read.directions[0].photos).toEqual([1, 3]); // the original is left alone
  });

  it("shares the top of the board first, up to 60 photos", () => {
    const board = Array.from({ length: 70 }, (_, i) => item(`p${i}`, (i % 4) * 250, 18 + Math.floor(i / 4) * 300));
    const shared = photosToShare([...board].reverse());
    expect(shared).toHaveLength(60);
    expect(shared.slice(0, 5).map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("notices changes worth publishing, and ignores ones that aren't", () => {
    const details = { name: "Maya", bio: "", link: "" };
    const board = [item("a", 0, 18), item("b", 250, 18)];
    const before = shareSignature(details, board, 1);
    expect(shareSignature(details, [board[0], { ...board[1], z: 9 }], 1)).toBe(before); // brought to the front only
    expect(shareSignature(details, [board[0], { ...board[1], x: 300 }], 1)).not.toBe(before);
    expect(shareSignature({ ...details, bio: "70s" }, board, 1)).not.toBe(before);
    expect(shareSignature(details, board, 2)).not.toBe(before); // a new style read
    expect(shareSignature(details, board.slice(0, 1), 1)).not.toBe(before);
  });
});
