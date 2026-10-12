// The stylist: one turn. Claude sees the moodboard and the conversation, searches
// through a tool, looks at the listing photos, and answers with one short line plus
// its picks, ranked best first (ids only: no per-item writing, to save tokens).

import type Anthropic from "@anthropic-ai/sdk";
import type { HistoryTurn, Listing, Prefs, StyleProfile } from "../types";
import { claude, FALLBACKS, finalText, MODEL, StylistError } from "./claude";
import { ebayConfigured } from "./ebay";
import type { Photo } from "./fetching";
import { runSearch, type SearchContext, type SearchInput, type SearchOutcome } from "./search";
import { SHOPS } from "./shops";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlockParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export const SYSTEM = `You are shopr, a personal stylist. You help one person find secondhand and vintage clothes they will love. Their moodboard shows you their taste; their messages tell you what they want now.

Their moodboard
- The moodboard photos and notes at the start of the conversation are the truth about their taste. Look closely: silhouettes and proportions, fabrics and how they have worn, washes and colours, eras, makers, and how pieces are put together.

Finding things
- To recommend anything to buy, call search_listings. It searches eBay and independent vintage and archive shops at once and shows you each listing's photo with its title, price in USD and size when known.
- Write 2 to 4 searches that come at the request from different angles: the obvious garment, a close cousin, a maker or detail that fits their board. For eBay, write the way a seller titles a listing: the garment plus the details that matter (fabric, wash, era, cut, maker), 2 to 6 words. For the shops, give 1 to 3 plain words a product title would contain.
- When they share a photo and want something like it, set use_attached_photo. When they point at moodboard photos, put those photo numbers in board_photos. Photo searches only work on eBay.
- If the results are weak, you may search once more with different words. Never search more than twice for one message.
- If they want advice rather than things to buy (how something should fit, what goes with what), answer without searching.

Choosing
- Judge listings by their photos first. Pick what actually looks like their board: the cut, the fabric, the colour, the wear. A matching title with the wrong look is a miss.
- Rank every listing that genuinely suits them, best first, up to 24. Their home screen shows your first nine as photos with price and shop; a "More picks" page shows the rest. Mix the directions in their taste near the top rather than nine of one thing. Leave out anything that doesn't fit; never pad.
- Respect their sizes and budget. Only pick listings from the search results, using their ids exactly as shown.

Writing
- message: one short sentence (under 25 words), warm and direct, saying what you went for. Don't describe individual picks. No filler words such as elevated, effortless, timeless, curated, vibe, aesthetic or must-have. No exclamation marks, no emoji. If nothing was good enough, say so and suggest what to try.
- picks: the listing ids only, best first.
- follow_ups: two or three short next requests written in their voice, such as "Only jackets" or "Something dressier".`;

export const SEARCH_TOOL: Anthropic.Beta.BetaTool = {
  name: "search_listings",
  description:
    "Search eBay and independent vintage and archive shops for listings to recommend. Returns up to 30 listings, each with an id, its photo, title, price in USD, and size when known. Call this before recommending anything to buy.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      searches: {
        type: "array",
        description: "2 to 4 searches that cover the request from different angles.",
        items: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "eBay search written like a listing title: garment plus the details that matter, 2 to 6 words, e.g. 'vintage carhartt chore coat blanket lined'.",
            },
            shop_query: {
              type: "string",
              description: "1 to 3 plain words for small shops' search boxes, which only match words in product titles, e.g. 'chore coat'.",
            },
            kind: { type: "string", enum: ["clothing", "shoes", "accessories"] },
          },
          required: ["query", "shop_query", "kind"],
          additionalProperties: false,
        },
      },
      use_attached_photo: {
        type: "boolean",
        description: "Also run eBay's photo search with the photo attached to their latest message.",
      },
      board_photos: {
        type: "array",
        items: { type: "integer" },
        description: "Moodboard photo numbers (at most 2) to run eBay's photo search with. Usually empty.",
      },
      min_price: { anyOf: [{ type: "number" }, { type: "null" }], description: "Lowest price in USD, or null for their usual budget." },
      max_price: { anyOf: [{ type: "number" }, { type: "null" }], description: "Highest price in USD, or null for their usual budget." },
    },
    required: ["searches", "use_attached_photo", "board_photos", "min_price", "max_price"],
    additionalProperties: false,
  },
};

export const REPLY_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      message: { type: "string" },
      picks: { type: "array", items: { type: "string" } },
      follow_ups: { type: "array", items: { type: "string" } },
    },
    required: ["message", "picks", "follow_ups"],
    additionalProperties: false,
  },
};

const MAX_PICKS = 24;
const MAX_SEARCHES = 2;
const MAX_STEPS = 4;

export type ChatInput = {
  message: string;
  photo: Photo | null; // attached to this message
  history: HistoryTurn[];
  board: string[]; // base64 JPEGs
  profile: StyleProfile | null;
  prefs: Prefs;
  seen: string[];
};

export type Reply = { message: string; picks: Listing[]; followUps: string[]; query: string | null };

export type StylistDeps = {
  create: (params: CreateParams, options: { signal?: AbortSignal }) => Promise<Anthropic.Beta.BetaMessage>;
  search: (input: SearchInput, ctx: SearchContext) => Promise<SearchOutcome>;
  ebayConfigured: () => boolean;
};

const realDeps: StylistDeps = {
  create: (params, options) => claude().beta.messages.create(params, options),
  search: (input, ctx) => runSearch(input, ctx),
  ebayConfigured,
};

const money = (n: number) => `$${Math.round(n)}`;

export function aboutMe(prefs: Prefs): string {
  const dept = { men: "menswear", women: "womenswear", any: "any department" }[prefs.department];
  const sizes = [
    prefs.tops.length ? `tops ${prefs.tops.join(", ")}` : "",
    prefs.waist.length ? `waist ${prefs.waist.join(", ")}` : "",
    prefs.shoes.length ? `shoes (US) ${prefs.shoes.join(", ")}` : "",
  ].filter(Boolean);
  const budget =
    prefs.minPrice != null && prefs.maxPrice != null
      ? `${money(prefs.minPrice)} to ${money(prefs.maxPrice)} a piece`
      : prefs.maxPrice != null
        ? `up to ${money(prefs.maxPrice)} a piece`
        : prefs.minPrice != null
          ? `from ${money(prefs.minPrice)} a piece`
          : "not set";
  const lines = [
    `- Shopping for: ${dept}`,
    `- Sizes: ${sizes.length ? sizes.join("; ") : "not given"}`,
    `- Budget: ${budget}`,
  ];
  if (prefs.avoid.trim()) lines.push(`- Leave out: ${prefs.avoid.trim()}`);
  return lines.join("\n");
}

export function profileNotes(p: StyleProfile): string {
  return [
    `${p.headline}. ${p.summary}`,
    ...p.directions.map((d) => `- ${d.name}: ${d.description}${d.photos.length ? ` (photos ${d.photos.join(", ")})` : ""}`),
    `Key pieces: ${p.key_pieces.join(", ")}. Palette: ${p.palette.join(", ")}. Fit: ${p.fit}`,
    `Worth looking for: ${p.look_for.join(", ")}. Avoid: ${p.avoid.join(", ")}.`,
  ].join("\n");
}

function sourcesLine(ebay: boolean): string {
  const shops = SHOPS.map((s) => `${s.name} (${s.focus})`).join("; ");
  return `${ebay ? "eBay is connected (keyword and photo search)." : "eBay is not connected, so only the shops can be searched and photo searches don't work."} Independent shops: ${shops}.`;
}

function image(data: string, mediaType: Photo["mediaType"] = "image/jpeg"): ContentBlock {
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

/** The moodboard and notes that open every conversation (cached between turns). */
export function boardMessage(input: ChatInput, ebay: boolean): MessageParam {
  const content: ContentBlock[] = [];
  if (input.board.length) {
    content.push({ type: "text", text: `My moodboard (${input.board.length} photos, numbered in order):` });
    input.board.forEach((data, i) => {
      content.push({ type: "text", text: `Photo ${i + 1}` });
      content.push(image(data));
    });
  } else {
    content.push({ type: "text", text: "I haven't added any photos to my moodboard yet." });
  }
  const notes = [
    input.profile ? `Your earlier read of my style:\n${profileNotes(input.profile)}` : "",
    `About me:\n${aboutMe(input.prefs)}`,
    `Where you can search: ${sourcesLine(ebay)}`,
  ].filter(Boolean);
  content.push({ type: "text", text: notes.join("\n\n"), cache_control: { type: "ephemeral" } });
  return { role: "user", content };
}

export function historyMessages(history: HistoryTurn[]): MessageParam[] {
  return history
    .filter((t) => t.text.trim())
    .slice(-12)
    .map((t): MessageParam => {
      if (t.role === "user") return { role: "user", content: [{ type: "text", text: t.text.trim() }] };
      const shown = (t.picks ?? []).map((p, i) => `${i + 1}. ${p.title} (${p.price}, ${p.source})`);
      const text = shown.length ? `${t.text.trim()}\n\nPicks I showed:\n${shown.join("\n")}` : t.text.trim();
      return { role: "assistant", content: [{ type: "text", text }] };
    });
}

function currentMessage(input: ChatInput): MessageParam {
  const text = input.message.trim() || "Find me something like this.";
  const content: ContentBlock[] = [];
  if (input.photo) content.push(image(input.photo.data, input.photo.mediaType));
  content.push({ type: "text", text, cache_control: { type: "ephemeral" } });
  return { role: "user", content };
}

function describe(l: Listing): string {
  const bits = [l.source, l.title || "(no title)"];
  if (l.priceUsd != null) bits.push(l.currency && l.currency !== "USD" && l.price != null ? `$${l.priceUsd} (${l.price} ${l.currency})` : `$${l.priceUsd}`);
  else if (l.price != null) bits.push(`${l.price} ${l.currency ?? ""}`.trim());
  if (l.sizes.length) bits.push(`size ${l.sizes.join("/")}`);
  if (l.condition) bits.push(l.condition);
  if (l.details) bits.push(`"${l.details.slice(0, 160)}"`);
  return bits.join(" · ");
}

export function searchStatus(input: SearchInput, ebay: boolean, again: boolean): string {
  const quoted = input.searches.slice(0, 4).map((s) => `“${s.query}”`);
  const list = quoted.length > 1 ? `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}` : (quoted[0] ?? "");
  const photos = (input.use_attached_photo ? 1 : 0) + Math.min(2, input.board_photos.length);
  const where = ebay ? `eBay and ${SHOPS.length} shops` : `${SHOPS.length} shops`;
  return `${again ? "Searching again" : "Searching"} ${where} for ${list}${photos && ebay ? ", plus a photo search" : ""}`;
}

/** Parse the tool input defensively (strict tools guarantee the shape, but be safe). */
export function toSearchInput(raw: unknown): SearchInput {
  const r = (raw ?? {}) as Partial<SearchInput>;
  const kinds = new Set(["clothing", "shoes", "accessories"]);
  return {
    searches: (Array.isArray(r.searches) ? r.searches : [])
      .filter((s) => s && typeof s.query === "string")
      .map((s) => ({
        query: s.query,
        shop_query: typeof s.shop_query === "string" ? s.shop_query : s.query,
        kind: kinds.has(s.kind) ? s.kind : "clothing",
      })),
    use_attached_photo: r.use_attached_photo === true,
    board_photos: (Array.isArray(r.board_photos) ? r.board_photos : []).filter((n) => Number.isInteger(n) && n > 0),
    min_price: typeof r.min_price === "number" ? r.min_price : null,
    max_price: typeof r.max_price === "number" ? r.max_price : null,
  };
}

export async function runStylist(
  input: ChatInput,
  emit: (event: { type: "status" | "notice"; text: string }) => void,
  signal?: AbortSignal,
  deps: StylistDeps = realDeps,
): Promise<Reply> {
  const ebay = deps.ebayConfigured();
  const messages: MessageParam[] = [boardMessage(input, ebay), ...historyMessages(input.history), currentMessage(input)];
  const shown = new Map<string, Listing>(); // candidate id -> listing, for this turn
  const seen = new Set(input.seen);
  let searchesRun = 0;
  let firstQuery: string | null = null;

  emit({ type: "status", text: "Thinking" });
  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await deps.create(
      {
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        tools: [SEARCH_TOOL],
        messages,
        output_config: { effort: "medium", format: REPLY_FORMAT },
        ...FALLBACKS,
      },
      { signal },
    );

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason === "tool_use" && toolUses.length) {
      messages.push({ role: "assistant", content: response.content as ContentBlock[] });
      const results: ToolResult[] = [];
      for (const use of toolUses) {
        if (use.name !== SEARCH_TOOL.name) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "That tool doesn't exist." });
          continue;
        }
        if (searchesRun >= MAX_SEARCHES || step === MAX_STEPS - 1) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: "No more searches for this message. Choose from the listings you already have, or say nothing fit.",
          });
          continue;
        }
        const search = toSearchInput(use.input);
        firstQuery ??= search.searches[0]?.query ?? null;
        emit({ type: "status", text: searchStatus(search, ebay, searchesRun > 0) });
        searchesRun++;
        const outcome = await deps.search(search, {
          prefs: input.prefs,
          // A second search shouldn't bring back what the first one already showed.
          seen: new Set([...seen, ...[...shown.values()].map((l) => l.id)]),
          photo: input.photo?.data ?? null,
          board: input.board,
          signal,
        });
        for (const problem of outcome.problems) emit({ type: "notice", text: problem });
        emit({ type: "status", text: `Looking through ${outcome.candidates.length} listings` });
        results.push(toolResult(use.id, outcome, shown, searchesRun === 1));
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = finalText(response);
    let parsed: { message?: unknown; picks?: unknown; follow_ups?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new StylistError("Your stylist's answer came back garbled. Try again.");
    }
    return toReply(parsed, shown, firstQuery);
  }
  throw new StylistError("Your stylist got stuck on that one. Try asking again.");
}

function toolResult(id: string, outcome: SearchOutcome, shown: Map<string, Listing>, cache: boolean): ToolResult {
  const content: Array<Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaImageBlockParam> = [
    { type: "text", text: outcome.summary },
  ];
  if (!outcome.candidates.length) {
    content.push({ type: "text", text: "Nothing matched. Try different or broader words, or a wider budget." });
  }
  for (const { listing, photo } of outcome.candidates) {
    const key = `L${shown.size + 1}`;
    shown.set(key, listing);
    content.push({ type: "text", text: `${key} · ${describe(listing)}` });
    content.push({ type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.data } });
  }
  // Cache the first set of results so the follow-up calls in this turn re-read them cheaply.
  return { type: "tool_result", tool_use_id: id, content, ...(cache ? { cache_control: { type: "ephemeral" as const } } : {}) };
}

export function toReply(
  parsed: { message?: unknown; picks?: unknown; follow_ups?: unknown },
  shown: Map<string, Listing>,
  query: string | null,
): Reply {
  const used = new Set<string>();
  const picks: Listing[] = [];
  for (const raw of Array.isArray(parsed.picks) ? parsed.picks : []) {
    const listing = typeof raw === "string" ? shown.get(raw.trim()) : undefined;
    if (!listing || used.has(listing.id)) continue;
    used.add(listing.id);
    picks.push(listing);
    if (picks.length >= MAX_PICKS) break;
  }
  const followUps = (Array.isArray(parsed.follow_ups) ? parsed.follow_ups : [])
    .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
    .map((f) => f.trim())
    .slice(0, 3);
  const message = typeof parsed.message === "string" && parsed.message.trim() ? parsed.message.trim() : "Here's what I found.";
  return { message, picks, followUps, query };
}
