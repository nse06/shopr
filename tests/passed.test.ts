import { describe, expect, it } from "vitest";
import { getState, passOn, setState, undoPass } from "@/lib/client/store";
import { passedNote } from "@/lib/server/stylist";
import type { Listing } from "@/lib/types";

const listing = (id: string): Listing => ({
  id,
  source: "Depop",
  title: `Piece ${id}`,
  price: 40,
  currency: "USD",
  priceUsd: 40,
  url: `https://www.depop.com/products/${id}/`,
  image: "",
  thumb: "",
  sizes: [],
  condition: null,
  details: "",
});

describe("Not for me", () => {
  it("takes the pick off the feed, remembers it, and can put it back where it was", () => {
    const picks = ["a", "b", "c", "d"].map(listing);
    setState({ feed: { picks, request: null, query: null, at: 1 }, passed: [] });

    const index = passOn(picks[1]);
    expect(index).toBe(1);
    expect(getState().feed?.picks.map((p) => p.id)).toEqual(["a", "c", "d"]); // the next pick moves up
    expect(getState().passed).toEqual([{ id: "b", title: "Piece b", source: "Depop", at: expect.any(Number) }]);

    undoPass(picks[1], index);
    expect(getState().feed?.picks.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(getState().passed).toEqual([]);
  });

  it("tells the stylist what was passed on, newest first", () => {
    expect(passedNote([])).toBeNull();
    const note = passedNote([
      { title: "Cropped puffer", source: "Depop" },
      { title: "Logo tee", source: "eBay" },
    ]);
    expect(note).toContain("Not for me");
    expect(note).toContain("1. Cropped puffer (Depop)\n2. Logo tee (eBay)");
  });
});
