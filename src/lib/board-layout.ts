// Where photos go on the moodboard. Positions are in board units: the board is
// always 1000 wide and scales to the screen, so a layout looks the same at any size.
// Each photo sits in a polaroid frame (wider at the bottom) with a slight tilt, and
// new photos drop into the shortest column with a little jitter, like a real pinboard.

export const BOARD_W = 1000;
export const FRAME_SIDE = 8;
export const FRAME_BOTTOM = 26;
export const GAP = 18;
export const MIN_W = 110;
export const MAX_W = 700;

export type Placed = { id: string; x: number; y: number; w: number; aspect: number; z: number; rot?: number };

/** Height of a framed photo `w` wide; aspect is the photo's height / width. */
export function frameHeight(w: number, aspect: number): number {
  return (w - 2 * FRAME_SIDE) * aspect + FRAME_SIDE + FRAME_BOTTOM;
}

export function bottom(item: Placed): number {
  return item.y + frameHeight(item.w, item.aspect);
}

export function boardHeight(items: Placed[]): number {
  return items.reduce((h, item) => Math.max(h, bottom(item)), 0);
}

/** A repeatable random number generator (0 to 1), seeded by a string such as a photo's id. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const within = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A photo's tilt in degrees: its own, or one made up from its id (photos pinned before tilts existed). */
export function tilt(item: { id: string; rot?: number }): number {
  if (typeof item.rot === "number") return item.rot;
  return round1(seeded(`${item.id}:tilt`)() * 8 - 4);
}

/** The small, fixed-per-photo differences that make a board look pinned by hand. */
function jitter(seed: string): { size: number; dx: number; dy: number; rot: number } {
  const rand = seeded(seed);
  return { size: rand() * 2 - 1, dx: (rand() * 2 - 1) * 10, dy: rand() * 12, rot: round1(rand() * 8 - 4) };
}

/** The spot for a new photo: the top of the shortest column, a little off-centre and tilted. */
export function place(items: Placed[], columns: number, seed: string): { x: number; y: number; w: number; rot: number } {
  const j = jitter(seed);
  const colW = BOARD_W / columns;
  const w = colW * 0.86 + j.size * colW * 0.07;
  const bottoms = Array.from({ length: columns }, () => GAP);
  for (const it of items) {
    const col = within(Math.floor((it.x + it.w / 2) / colW), 0, columns - 1);
    bottoms[col] = Math.max(bottoms[col], bottom(it) + GAP);
  }
  let col = 0;
  for (let c = 1; c < columns; c++) if (bottoms[c] < bottoms[col] - 1) col = c;
  return {
    x: round1(within(col * colW + (colW - w) / 2 + j.dx, 0, BOARD_W - w)),
    y: round1(bottoms[col] + j.dy),
    w: round1(w),
    rot: j.rot,
  };
}

/** Top to bottom, then left to right (photos whose tops are close count as one row). */
export function readingOrder<T extends Placed>(items: T[]): T[] {
  return [...items].sort((a, b) => Math.floor(a.y / 40) - Math.floor(b.y / 40) || a.x - b.x);
}

/**
 * The order photos were pinned in, on a board nobody has rearranged since: by where
 * each would sit without its little random drop. Tidying in this order puts every
 * photo back where it was, so tidying a tidy board changes nothing.
 */
export function pinnedOrder<T extends Placed>(items: T[]): T[] {
  const top = new Map(items.map((i) => [i.id, i.y - jitter(i.id).dy]));
  return [...items].sort((a, b) => {
    const dy = top.get(a.id)! - top.get(b.id)!;
    return Math.abs(dy) > 1 ? dy : a.x - b.x;
  });
}

/** Re-pin every photo into columns, keeping their order and their tilt. */
export function tidy<T extends Placed>(items: T[], columns: number): T[] {
  const out: T[] = [];
  for (const item of pinnedOrder(items)) out.push({ ...item, ...place(out, columns, item.id), rot: tilt(item) });
  return out;
}

/** Keep a moved or resized photo on the board. */
export function clamp(item: { x: number; y: number; w: number }): { x: number; y: number; w: number } {
  const w = round1(within(item.w, MIN_W, MAX_W));
  return { w, x: round1(within(item.x, 0, BOARD_W - w)), y: round1(Math.max(0, item.y)) };
}
