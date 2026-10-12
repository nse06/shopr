// Today's drop: picks from the moodboard for the price of one Claude call.
//
// The chat stylist plans its own searches and looks at the whole board, which takes
// two calls. A drop needs neither: its searches come from the saved style read
// (rotating day by day), and one call looks at small photos of the candidates next to
// the written style read and a few board photos, then ranks them.

import type Anthropic from "@anthropic-ai/sdk";
import { DROP_SIZE, type Kind, type Listing, type Prefs, type ProfileSearch, type StyleProfile } from "../types";
import { claude, FALLBACKS, finalText, MODEL, StylistError } from "./claude";
import type { Meter } from "./costs";
import { resizePhoto, type Photo } from "./fetching";
import { runSearch, type Candidate, type Deps, type SearchInput } from "./search";
import { aboutMe, describe, passedNote, profileNotes } from "./stylist";

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;
export type Create = (params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, options: { signal?: AbortSignal }) => Promise<Anthropic.Beta.BetaMessage>;

/** How a drop is made: which model ranks, how hard it thinks, and how much it sees. */
export type DropSetup = { model: string; effort: "low" | "medium" | "high"; boardPhotos: number; photoSide: number; candidates: number };

export function dropSetup(size = DROP_SIZE): DropSetup {
  return {
    model: process.env.DROP_MODEL || MODEL,
    effort: "low",
    boardPhotos: 8,
    photoSide: 384,
    candidates: Math.min(48, Math.max(20, size + 8)), // 20 for a drop of 12
  };
}

export const today = (now = Date.now()) => Math.floor(now / 86_400_000);

const SHOES = /\b(boots?|shoes?|sneakers?|trainers?|loafers?|clogs?|sandals?|mules?|derbies|brogues?)\b/i;
const ACCESSORIES = /\b(bags?|belts?|hats?|caps?|beanies?|scarf|scarves|watch(es)?|sunglasses|wallets?|ties?|jewelry|jewellery|rings?|necklaces?|bracelets?)\b/i;

export function kindOf(text: string): Kind {
  return SHOES.test(text) ? "shoes" : ACCESSORIES.test(text) ? "accessories" : "clothing";
}

const lastWords = (text: string, n: number) => text.trim().split(/\s+/).slice(-n).join(" ");

/** The style read's own searches, or ones made from its makers and key pieces (reads from before it wrote searches). */
export function profileSearches(p: StyleProfile): ProfileSearch[] {
  if (p.searches?.length) return p.searches;
  const looks = p.look_for.map((q) => ({ query: q, shop_query: lastWords(q, 2), kind: kindOf(q) }));
  const pieces = p.key_pieces.map((q) => ({ query: `vintage ${q}`, shop_query: lastWords(q, 2), kind: kindOf(q) }));
  const out: ProfileSearch[] = [];
  for (let i = 0; i < Math.max(looks.length, pieces.length); i++) {
    if (looks[i]) out.push(looks[i]);
    if (pieces[i]) out.push(pieces[i]);
  }
  return out;
}

/** A few searches for today (round 0) or the next batch (round 1, 2, ...), moving through the list day by day. */
export function planSearches(p: StyleProfile, day: number, round = 0, count = 3): SearchInput["searches"] {
  const all = profileSearches(p);
  if (!all.length) return [];
  const n = Math.min(count, all.length);
  const start = (((day + round) * n) % all.length + all.length) % all.length;
  return Array.from({ length: n }, (_, i) => all[(start + i) % all.length]);
}

// --- Ranking ---

const SYSTEM = `You are shopr, a personal stylist who knows clothes deeply: vintage and secondhand, workwear and military surplus, tailoring, sportswear, Japanese and European designers, archive fashion, and how sellers describe things.

Each day you choose a drop for one person: the secondhand listings from today's candidates that suit them best. Judge each listing by its photo against their moodboard and style read: the cut and proportions, the fabric and how it has worn, the colour, the era and maker, and whether they would actually wear it. Leave out anything that doesn't suit their taste, however good the piece. Spread the drop across the directions in their style rather than repeating one idea, and respect their sizes and budget.

Reply with listing ids, best first, and a note: one short sentence (under 15 words) on what today's drop leans into.`;

export const DROP_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: { picks: { type: "array", items: { type: "string" } }, note: { type: "string" } },
    required: ["picks", "note"],
    additionalProperties: false,
  },
};

/** Haiku has no server-side fallback for declined requests; the others use the default one. */
export function fallbacksFor(model: string) {
  return model.startsWith("claude-haiku") ? {} : FALLBACKS;
}

const image = (p: Photo): ContentBlock => ({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } });

export type Ranked = { picks: Listing[]; note: string };

/** One call: the style read, a few board photos and the candidates, ranked best first. */
export async function rankDrop(args: {
  profile: StyleProfile;
  board: Photo[];
  candidates: Candidate[];
  prefs: Prefs;
  passed?: { title: string; source: string }[];
  size: number;
  setup: Pick<DropSetup, "model" | "effort">;
  signal?: AbortSignal;
  meter?: Meter;
  create?: Create;
}): Promise<Ranked> {
  const { profile, board, candidates, prefs, size, setup } = args;
  const create: Create = args.create ?? ((params, options) => claude().beta.messages.create(params, options));
  const content: ContentBlock[] = [{ type: "text", text: `My style, as you read it from my moodboard:\n${profileNotes(profile)}` }];
  if (board.length) {
    content.push({ type: "text", text: `${board.length} photos from my moodboard:` });
    for (const p of board) content.push(image(p));
  }
  const passed = passedNote(args.passed ?? []);
  content.push({ type: "text", text: `About me:\n${aboutMe(prefs)}${passed ? `\n\n${passed}` : ""}` });
  content.push({ type: "text", text: `Today's candidates (${candidates.length}). Each photo is followed by its id and details.` });
  candidates.forEach((c, i) => {
    content.push(image(c.photo));
    content.push({ type: "text", text: `L${i + 1} · ${describe(c.listing)}` });
  });
  content.push({ type: "text", text: `Choose the ${size} that suit me best, best first. Fewer is fine if fewer fit.` });

  const response = await create(
    {
      model: setup.model,
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { effort: setup.effort, format: DROP_FORMAT },
      ...fallbacksFor(setup.model),
    },
    { signal: args.signal },
  );
  args.meter?.claudeUsed(response);

  let parsed: { picks?: unknown; note?: unknown };
  try {
    parsed = JSON.parse(finalText(response));
  } catch (e) {
    if (e instanceof StylistError) throw e;
    throw new StylistError("Today's drop came back garbled. Try again.");
  }
  const byId = new Map(candidates.map((c, i) => [`L${i + 1}`, c.listing]));
  const picks: Listing[] = [];
  for (const id of Array.isArray(parsed.picks) ? parsed.picks : []) {
    const listing = typeof id === "string" ? byId.get(id.trim()) : undefined;
    if (listing && !picks.includes(listing)) picks.push(listing);
    if (picks.length >= size) break;
  }
  return { picks, note: typeof parsed.note === "string" ? parsed.note.trim().slice(0, 200) : "" };
}

// --- The whole drop ---

export type DropInput = {
  profile: StyleProfile;
  board: string[]; // a few base64 JPEGs from the moodboard
  prefs: Prefs;
  seen: string[];
  passed: { title: string; source: string }[];
  size: number;
  round: number; // 0 for today's drop, then 1, 2, ... for more
};

export type DropResult = { picks: Listing[]; note: string; query: string | null; problems: string[] };

/** Today's candidates: the day's searches from the style read, Depop for the first one only. */
export async function dropPool(
  input: Pick<DropInput, "profile" | "prefs" | "seen" | "round">,
  opts: { candidates: number; photoSide: number; day?: number; signal?: AbortSignal; meter?: Meter; deps?: Deps },
) {
  const searches = planSearches(input.profile, opts.day ?? today(), input.round);
  const outcome = await runSearch(
    { searches, use_attached_photo: false, board_photos: [], min_price: null, max_price: null },
    {
      prefs: input.prefs,
      seen: new Set(input.seen),
      photo: null,
      board: [],
      signal: opts.signal,
      meter: opts.meter,
      depopSearches: 1,
      maxCandidates: opts.candidates,
      photoSide: opts.photoSide,
    },
    opts.deps,
  );
  return { candidates: outcome.candidates, searches: searches.map((s) => s.query), query: searches[0]?.query ?? null, problems: outcome.problems };
}

export async function runDrop(input: DropInput, ctx: { signal?: AbortSignal; meter?: Meter; deps?: Deps; create?: Create } = {}): Promise<DropResult> {
  const setup = dropSetup(input.size);
  const pool = await dropPool(input, { candidates: setup.candidates, photoSide: setup.photoSide, signal: ctx.signal, meter: ctx.meter, deps: ctx.deps });
  if (!pool.candidates.length) {
    return { picks: [], note: "Nothing new turned up today. Try again later, or ask for something.", query: pool.query, problems: pool.problems };
  }
  const board = await Promise.all(input.board.slice(0, setup.boardPhotos).map((data) => resizePhoto({ data, mediaType: "image/jpeg" }, setup.photoSide)));
  const ranked = await rankDrop({
    profile: input.profile,
    board,
    candidates: pool.candidates,
    prefs: input.prefs,
    passed: input.passed,
    size: input.size,
    setup,
    signal: ctx.signal,
    meter: ctx.meter,
    create: ctx.create,
  });
  return { ...ranked, query: pool.query, problems: pool.problems };
}
