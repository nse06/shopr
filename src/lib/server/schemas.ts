import { z } from "zod";
import { DEFAULT_PREFS } from "../types";

// Photos arrive as base64 JPEGs, already shrunk in the browser.
const photo = z.string().max(1_500_000).regex(/^[A-Za-z0-9+/=]+$/);
const sizeList = z.array(z.string().max(12)).max(20);

export const PrefsSchema = z
  .object({
    department: z.enum(["men", "women", "any"]),
    tops: sizeList,
    waist: sizeList,
    shoes: sizeList,
    minPrice: z.number().min(0).max(100_000).nullable(),
    maxPrice: z.number().min(0).max(100_000).nullable(),
    avoid: z.string().max(500),
  })
  .partial()
  .transform((p) => ({ ...DEFAULT_PREFS, ...p }));

const ProfileSchema = z.object({
  headline: z.string().max(200),
  summary: z.string().max(2000),
  directions: z
    .array(z.object({ name: z.string().max(120), description: z.string().max(600), photos: z.array(z.number().int()).max(60) }))
    .max(6),
  key_pieces: z.array(z.string().max(120)).max(12),
  palette: z.array(z.string().max(60)).max(10),
  fit: z.string().max(600),
  look_for: z.array(z.string().max(120)).max(12),
  avoid: z.array(z.string().max(120)).max(10),
});

export const MAX_BOARD = 36;

export const ChatSchema = z.object({
  message: z.string().max(2000),
  photo: photo.nullable().default(null),
  // "More like this": a listing photo the server fetches itself (browsers can't read it).
  photoUrl: z.string().url().max(2000).nullable().default(null),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "stylist"]),
        text: z.string().max(4000),
        picks: z.array(z.object({ title: z.string().max(300), price: z.string().max(40), source: z.string().max(80) })).max(8).optional(),
      }),
    )
    .max(40)
    .default([]),
  board: z.array(photo.max(400_000)).max(MAX_BOARD).default([]),
  profile: ProfileSchema.nullable().default(null),
  prefs: PrefsSchema.default(DEFAULT_PREFS),
  seen: z.array(z.string().max(200)).max(400).default([]),
});

export const ProfileRequestSchema = z.object({
  board: z.array(photo.max(400_000)).min(1).max(MAX_BOARD),
  prefs: PrefsSchema.default(DEFAULT_PREFS),
});

export function badRequest(error: z.ZodError): Response {
  const first = error.issues[0];
  return Response.json(
    { error: "bad_request", message: `Something in the request wasn't right (${first?.path.join(".") || "body"}).` },
    { status: 400 },
  );
}
