// Where photos go on the moodboard. Positions are in board units: the board is
// always 1000 wide and scales to the screen, so a layout looks the same at any size.

export const BOARD_W = 1000;
export const GAP = 16;
export const MIN_W = 120;

export type Placed = { id: string; x: number; y: number; w: number; aspect: number; z: number; addedAt?: number };

export function bottom(item: Placed): number {
  return item.y + item.w * item.aspect;
}

export function boardHeight(items: Placed[]): number {
  return items.reduce((h, item) => Math.max(h, bottom(item)), 0);
}

function columns(w: number): number[] {
  const count = Math.max(1, Math.floor((BOARD_W + GAP) / (w + GAP)));
  const total = count * w + (count - 1) * GAP;
  const left = Math.max(0, (BOARD_W - total) / 2);
  return Array.from({ length: count }, (_, i) => Math.round(left + i * (w + GAP)));
}

/** The spot for a new photo of width w: the top of whichever column is shortest. */
export function place(items: Placed[], w: number): { x: number; y: number } {
  let best = { x: 0, y: Infinity };
  for (const x of columns(w)) {
    const under = items.filter((i) => i.x < x + w && i.x + i.w > x);
    const y = under.length ? Math.max(...under.map(bottom)) + GAP : 0;
    if (y < best.y) best = { x, y };
  }
  return best;
}

/** Re-pack every photo into neat columns, keeping their reading order. */
export function tidy<T extends Placed>(items: T[], w: number): T[] {
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: T[] = [];
  for (const item of order) {
    const spot = place(out, w);
    out.push({ ...item, x: spot.x, y: spot.y, w });
  }
  return out;
}

/** Keep a moved or resized photo on the board. */
export function clamp(item: { x: number; y: number; w: number }): { x: number; y: number; w: number } {
  const w = Math.round(Math.min(BOARD_W, Math.max(MIN_W, item.w)));
  return {
    w,
    x: Math.round(Math.min(BOARD_W - w, Math.max(0, item.x))),
    y: Math.round(Math.max(0, item.y)),
  };
}
