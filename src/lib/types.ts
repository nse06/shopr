// Shapes shared by the server routes and the browser.

export type Department = "men" | "women" | "any";
export type Kind = "clothing" | "shoes" | "accessories";

export type Listing = {
  id: string; // "ebay:v1|123|0" or "shop:<domain>:<id>"
  source: string; // "eBay" or the shop's name
  title: string;
  price: number | null;
  currency: string | null;
  priceUsd: number | null;
  url: string;
  image: string; // large photo for the page
  thumb: string; // small photo Claude looks at
  sizes: string[];
  condition: string | null;
  details: string; // a short bit of the description, when the shop gives one
};

export type Prefs = {
  department: Department;
  tops: string[];
  waist: string[];
  shoes: string[];
  minPrice: number | null;
  maxPrice: number | null;
  avoid: string; // comma-separated words to leave out
};

export const DEFAULT_PREFS: Prefs = {
  department: "any",
  tops: [],
  waist: [],
  shoes: [],
  minPrice: null,
  maxPrice: null,
  avoid: "",
};

export type StyleDirection = { name: string; description: string; photos: number[] };

export type StyleProfile = {
  headline: string;
  summary: string;
  directions: StyleDirection[];
  key_pieces: string[];
  palette: string[];
  fit: string;
  look_for: string[];
  avoid: string[];
};

// One earlier turn of the conversation, as the browser sends it back.
export type HistoryTurn = {
  role: "user" | "stylist";
  text: string;
  picks?: { title: string; price: string; source: string }[];
};

// What /api/chat streams back, one JSON object per line.
export type ChatEvent =
  | { type: "status"; text: string }
  | { type: "notice"; text: string }
  | { type: "reply"; message: string; picks: Listing[]; followUps: string[]; query: string | null }
  | { type: "error"; text: string };

export type Status = {
  claude: boolean;
  ebay: boolean;
  depop: boolean;
  sharing: boolean; // somewhere to keep public boards (a Vercel Blob store)
  shops: number;
  passwordRequired: boolean;
  authorized: boolean;
};

// Public boards: what anyone can see at /u/<handle>.
export type PublicPhoto = { id: string; url: string; aspect: number; x: number; y: number; w: number; rot: number; z: number };

export type PublicBoard = {
  handle: string;
  name: string;
  bio: string;
  link: string | null;
  photos: PublicPhoto[];
  profile: StyleProfile | null;
  createdAt: number;
  updatedAt: number;
};

export type BoardSummary = {
  handle: string;
  name: string;
  bio: string;
  headline: string;
  cover: string[]; // a few photo URLs
  count: number;
  tags: string[]; // words people can search by
  updatedAt: number;
};

// What running shopr costs (estimates from list prices), shown in Settings.
export type CostKind = "picks" | "chat" | "more" | "read";

export type CostEntry = { at: number; kind: CostKind; usd: number; claudeUsd: number; depopUsd: number; ok: boolean };

export type CostTotals = {
  usd: number;
  requests: number;
  byKind: Partial<Record<CostKind, { n: number; claudeUsd: number; depopUsd: number }>>;
};

export type CostSummary = { enabled: boolean; week: CostTotals; month: CostTotals; recent: CostEntry[] };
