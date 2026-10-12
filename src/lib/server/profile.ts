// Reading the moodboard: Claude looks at every photo and writes up the person's style.

import type Anthropic from "@anthropic-ai/sdk";
import type { Prefs, StyleProfile } from "../types";
import { claude, FALLBACKS, finalText, MODEL, StylistError } from "./claude";
import { aboutMe } from "./stylist";

const SYSTEM = `You are shopr, a personal stylist who knows clothes deeply: vintage and secondhand, workwear and military surplus, tailoring, sportswear, Japanese and European designers, archive fashion, and how sellers describe things.

Study the person's moodboard and describe their taste the way a sharp stylist would after going through their references: specific, warm and plain-spoken. Name the garments, fabrics, washes, colours, silhouettes, eras and makers you actually see. Avoid filler words such as elevated, effortless, timeless, curated, vibe, aesthetic and must-have, and don't flatter.

- headline: 3 to 7 words naming their style.
- summary: two or three sentences, addressed to them as "you", on what ties the board together.
- directions: the 1 to 4 distinct directions in the board (one is fine if it's cohesive), each with a short name, one sentence, and the photo numbers that belong to it.
- key_pieces: 4 to 8 garments that define the look.
- palette: 3 to 6 colour words.
- fit: one sentence on fit and proportion.
- look_for: 4 to 8 makers, details, fabrics or eras worth searching for.
- avoid: 2 to 5 things that would clash with this taste.`;

const strings = { type: "array", items: { type: "string" } };

export const PROFILE_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      summary: { type: "string" },
      directions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            photos: { type: "array", items: { type: "integer" } },
          },
          required: ["name", "description", "photos"],
          additionalProperties: false,
        },
      },
      key_pieces: strings,
      palette: strings,
      fit: { type: "string" },
      look_for: strings,
      avoid: strings,
    },
    required: ["headline", "summary", "directions", "key_pieces", "palette", "fit", "look_for", "avoid"],
    additionalProperties: false,
  },
};

type Create = (
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
  options: { signal?: AbortSignal },
) => Promise<Anthropic.Beta.BetaMessage>;

export async function readBoard(
  board: string[],
  prefs: Prefs,
  signal?: AbortSignal,
  create: Create = (params, options) => claude().beta.messages.create(params, options),
): Promise<StyleProfile> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  board.forEach((data, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
  });
  content.push({ type: "text", text: `About me:\n${aboutMe(prefs)}\n\nRead my moodboard.` });

  const response = await create(
    {
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { effort: "medium", format: PROFILE_FORMAT },
      ...FALLBACKS,
    },
    { signal },
  );
  let parsed: StyleProfile;
  try {
    parsed = JSON.parse(finalText(response));
  } catch (e) {
    if (e instanceof StylistError) throw e;
    throw new StylistError("The read of your board came back garbled. Try again.");
  }
  return clean(parsed, board.length);
}

function clean(p: StyleProfile, photos: number): StyleProfile {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
  return {
    headline: String(p.headline ?? "").trim(),
    summary: String(p.summary ?? "").trim(),
    directions: (Array.isArray(p.directions) ? p.directions : []).slice(0, 4).map((d) => ({
      name: String(d?.name ?? "").trim(),
      description: String(d?.description ?? "").trim(),
      photos: (Array.isArray(d?.photos) ? d.photos : []).filter((n) => Number.isInteger(n) && n >= 1 && n <= photos),
    })),
    key_pieces: list(p.key_pieces),
    palette: list(p.palette),
    fit: String(p.fit ?? "").trim(),
    look_for: list(p.look_for),
    avoid: list(p.avoid),
  };
}
