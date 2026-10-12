// The drop test on the server. For one board: gather today's candidates once, let each
// setup pick a drop from them, then have Opus score the drops side by side without
// knowing which setup made which. Sample boards are read once and the read is kept.

import type Anthropic from "@anthropic-ai/sdk";
import { outcomeKey, TEST_SETUPS, type BoardOutcome, type BoardResult, type PickSummary, type SetupResult, type TestBoard } from "../droptest";
import { DEFAULT_PREFS, DROP_SIZE, SHOWN, type Listing, type Prefs, type StyleProfile } from "../types";
import { claude, FALLBACKS, finalText, friendlyError, MODEL, StylistError } from "./claude";
import { Meter } from "./costs";
import { dropPool, rankDrop, type Create } from "./drop";
import { fetchPhoto, PHOTO_SIDE, resizePhoto, type Photo } from "./fetching";
import { readBoard } from "./profile";
import type { Deps } from "./search";
import { privateFolder, updateJson, type Store } from "./storage";
import { describe, profileNotes } from "./stylist";

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

const JUDGE_BOARD_SIDE = 384;
const JUDGE_PICK_SIDE = 256;

// --- The judge ---

const JUDGE_SYSTEM = `You are a senior stylist checking drops that junior stylists picked for one person. You see the person's style read and moodboard, then several sets of secondhand pieces chosen for them from the same listings, each set under a letter.

Score each set from 1 to 10 for how well it suits this person:
- 9 or 10: they would want nearly every piece, and the set covers the directions in their board.
- 6 to 8: mostly right, with a few misses or too much of one idea.
- 3 to 5: as many misses as hits.
- 1 or 2: mostly wrong for them.

Judge the pieces by their photos and details: cut, fabric, colour, era, maker and condition, against their board. A set isn't better for being bigger, or worse for being smaller if everything in it fits. Sets can share pieces; a piece counts the same wherever it appears. Score every set the same way.

Reply with one entry per set: its letter, its score and one short sentence on what it got right or wrong (the sentence is read without the letters, so don't refer to sets by letter).`;

export const JUDGE_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      sets: {
        type: "array",
        items: {
          type: "object",
          properties: { set: { type: "string" }, score: { type: "integer" }, why: { type: "string" } },
          required: ["set", "score", "why"],
          additionalProperties: false,
        },
      },
    },
    required: ["sets"],
    additionalProperties: false,
  },
};

const image = (p: Photo): ContentBlock => ({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } });

export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type Verdicts = Map<string, { score: number; why: string }>;

/** Scores each set of picks from 1 to 10. The judge sees them shuffled, under letters. */
export async function judgeDrops(args: {
  profile: StyleProfile;
  board: Photo[];
  sets: { id: string; picks: { listing: Listing; photo: Photo }[] }[];
  random?: () => number;
  signal?: AbortSignal;
  meter?: Meter;
  create?: Create;
}): Promise<Verdicts> {
  const create: Create = args.create ?? ((params, options) => claude().beta.messages.create(params, options));
  const order = shuffle(args.sets, args.random ?? Math.random);
  const letters = order.map((_, i) => String.fromCharCode(65 + i));
  const content: ContentBlock[] = [{ type: "text", text: `Their style, as read from their moodboard:\n${profileNotes(args.profile)}` }];
  if (args.board.length) content.push({ type: "text", text: `${args.board.length} photos from their moodboard:` }, ...args.board.map(image));
  order.forEach((set, i) => {
    content.push({ type: "text", text: `Set ${letters[i]} (${set.picks.length} piece${set.picks.length === 1 ? "" : "s"}):` });
    set.picks.forEach((p, n) => content.push(image(p.photo), { type: "text", text: `${letters[i]}${n + 1} · ${describe(p.listing)}` }));
  });
  content.push({ type: "text", text: `Score all ${order.length} sets.` });

  const response = await create(
    {
      model: MODEL,
      max_tokens: 8000,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { effort: "medium", format: JUDGE_FORMAT },
      ...FALLBACKS,
    },
    { signal: args.signal },
  );
  args.meter?.claudeUsed(response);
  let parsed: { sets?: { set?: unknown; score?: unknown; why?: unknown }[] };
  try {
    parsed = JSON.parse(finalText(response));
  } catch (e) {
    if (e instanceof StylistError) throw e;
    throw new StylistError("The judge's scores came back garbled.");
  }
  const verdicts: Verdicts = new Map();
  for (const s of Array.isArray(parsed.sets) ? parsed.sets : []) {
    const i = typeof s?.set === "string" ? letters.indexOf(s.set.replace(/^\s*set\s+/i, "").trim().toUpperCase()) : -1;
    const score = Number(s?.score);
    if (i < 0 || !Number.isFinite(score)) continue;
    verdicts.set(order[i].id, { score: Math.min(10, Math.max(1, Math.round(score))), why: typeof s.why === "string" ? s.why.trim().slice(0, 300) : "" });
  }
  return verdicts;
}

// --- One board ---

export type TestContext = {
  signal?: AbortSignal;
  meter?: Meter; // everything the test spends, for the cost log
  deps?: Deps;
  create?: Create;
  random?: () => number;
  store?: Store | null; // where sample boards' reads are kept
};

const round = (usd: number) => Math.round(usd * 1e5) / 1e5;

function priceText(l: Listing): string {
  if (l.priceUsd != null) return `$${Math.round(l.priceUsd)}`;
  return l.price != null ? `${l.price} ${l.currency ?? ""}`.trim() : "no price";
}

const summary = (l: Listing): PickSummary => ({ id: l.id, title: l.title, price: priceText(l), source: l.source, thumb: l.thumb });

/** A photo at most `side` pixels on its long side (the candidates arrive at PHOTO_SIDE). */
const fit = (p: Photo, side: number) => (side >= PHOTO_SIDE ? Promise.resolve(p) : resizePhoto(p, side));

export async function testBoard(
  input: { board: { id: string; title: string }; photos: Photo[]; profile: StyleProfile; prefs: Prefs; readUsd?: number },
  ctx: TestContext = {},
): Promise<BoardResult> {
  const { profile, prefs } = input;
  const poolMeter = new Meter();
  let pool: Awaited<ReturnType<typeof dropPool>>;
  try {
    pool = await dropPool(
      { profile, prefs, seen: [], round: 0 },
      { candidates: Math.max(...TEST_SETUPS.map((s) => s.candidates)), photoSide: PHOTO_SIDE, signal: ctx.signal, meter: poolMeter, deps: ctx.deps },
    );
  } finally {
    ctx.meter?.add(poolMeter);
  }
  if (!pool.candidates.length) {
    throw new StylistError(`Nothing turned up today for ${pool.searches.map((q) => `"${q}"`).join(", ") || "this board"}.`);
  }

  // Every setup sees the same board and listings, each at its own photo size.
  const sides = [...new Set([...TEST_SETUPS.map((s) => s.photoSide), JUDGE_BOARD_SIDE])];
  const boardAt = new Map(await Promise.all(sides.map(async (side) => [side, await Promise.all(input.photos.map((p) => fit(p, side)))] as const)));
  const poolAt = new Map(
    await Promise.all(sides.map(async (side) => [side, await Promise.all(pool.candidates.map(async (c) => ({ ...c, photo: await fit(c.photo, side) })))] as const)),
  );

  const runs = await Promise.all(
    TEST_SETUPS.map(async (setup) => {
      const meter = new Meter();
      const started = Date.now();
      try {
        const ranked = await rankDrop({
          profile,
          board: boardAt.get(setup.photoSide)!.slice(0, setup.boardPhotos),
          candidates: poolAt.get(setup.photoSide)!.slice(0, setup.candidates),
          prefs,
          size: DROP_SIZE,
          setup,
          signal: ctx.signal,
          meter,
          create: ctx.create,
        });
        // What For you would show is what gets judged.
        return { setup, meter, ms: Date.now() - started, ranked: { ...ranked, picks: ranked.picks.slice(0, SHOWN) } };
      } catch (e) {
        return { setup, meter, ms: Date.now() - started, error: friendlyError(e) };
      } finally {
        ctx.meter?.add(meter);
      }
    }),
  );

  const photoOf = new Map(pool.candidates.map((c) => [c.listing.id, c.photo]));
  const sets = await Promise.all(
    runs
      .filter((r) => r.ranked?.picks.length)
      .map(async (r) => ({
        id: r.setup.id,
        picks: await Promise.all(r.ranked!.picks.map(async (listing) => ({ listing, photo: await fit(photoOf.get(listing.id)!, JUDGE_PICK_SIDE) }))),
      })),
  );
  const judgeMeter = new Meter();
  let verdicts: Verdicts = new Map();
  let judgeError: string | undefined;
  if (sets.length) {
    try {
      verdicts = await judgeDrops({
        profile,
        board: boardAt.get(JUDGE_BOARD_SIDE)!.slice(0, 8),
        sets,
        random: ctx.random,
        signal: ctx.signal,
        meter: judgeMeter,
        create: ctx.create,
      });
    } catch (e) {
      judgeError = friendlyError(e);
    } finally {
      ctx.meter?.add(judgeMeter);
    }
  }

  const setups: SetupResult[] = runs.map((r) => {
    const c = r.meter.claude;
    const base = { setup: r.setup.id, usd: round(r.meter.usd), ms: r.ms, tokensIn: c.input + c.cacheRead + c.cacheWrite, tokensOut: c.output };
    if (!r.ranked) return { ...base, picks: [], note: "", score: null, why: "", error: r.error };
    // Picking nothing at all is as bad as a drop gets.
    const verdict = r.ranked.picks.length ? verdicts.get(r.setup.id) : { score: 1, why: "Picked nothing." };
    return { ...base, picks: r.ranked.picks.map(summary), note: r.ranked.note, score: verdict?.score ?? null, why: verdict?.why ?? "" };
  });

  return {
    board: input.board.id,
    title: input.board.title,
    headline: profile.headline,
    searches: pool.searches,
    candidates: pool.candidates.length,
    setups,
    judgeUsd: round(judgeMeter.usd),
    ...(judgeError ? { judgeError } : {}),
    readUsd: round(input.readUsd ?? 0),
    depopUsd: round(poolMeter.depop.usd),
    problems: pool.problems,
    at: Date.now(),
  };
}

// --- Sample boards and saved results ---

const folder = () => privateFolder("droptest");
// The version changes whenever the read changes, so old reads aren't reused.
const readPath = (board: string) => `${folder()}/reads/v1-${board}.json`;
const runPath = (run: string) => `${folder()}/runs/${run}.json`;

/** A sample board: its photos are fetched, and it's read the first time (the read is kept). */
export async function testSampleBoard(board: TestBoard, ctx: TestContext = {}): Promise<BoardResult> {
  const fetchOne = ctx.deps?.fetchPhoto ?? fetchPhoto;
  const photos = (await Promise.all(board.photos.map((url) => fetchOne(url, ctx.signal)))).filter((p): p is Photo => p != null);
  if (photos.length < 3) throw new StylistError("Couldn't load this board's photos. Try again.");

  let profile = (await ctx.store?.readJson<{ profile: StyleProfile }>(readPath(board.id)))?.data.profile ?? null;
  const readMeter = new Meter();
  if (!profile) {
    try {
      profile = await readBoard(
        photos.map((p) => p.data),
        DEFAULT_PREFS,
        { signal: ctx.signal, meter: readMeter },
        ctx.create,
      );
    } finally {
      ctx.meter?.add(readMeter);
    }
    await ctx.store?.writeJson(readPath(board.id), { profile, at: Date.now() }).catch((e) => console.error("couldn't keep the read", e));
  }
  return testBoard({ board, photos, profile, prefs: DEFAULT_PREFS, readUsd: readMeter.usd }, ctx);
}

type RunFile = { boards: Record<string, BoardOutcome> };

export async function saveOutcome(s: Store, run: string, attempt: number, outcome: BoardOutcome): Promise<void> {
  const key = outcomeKey(outcome.board, attempt);
  await updateJson<RunFile>(s, runPath(run), () => ({ boards: {} }), (file) => ({ boards: { ...file.boards, [key]: outcome } }));
}

export async function runOutcomes(s: Store, run: string): Promise<Record<string, BoardOutcome>> {
  return (await s.readJson<RunFile>(runPath(run)))?.data.boards ?? {};
}
