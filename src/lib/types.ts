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

export type Pick = Listing & { why: string };

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
  | { type: "reply"; message: string; picks: Pick[]; followUps: string[]; query: string | null }
  | { type: "error"; text: string };

export type Status = {
  claude: boolean;
  ebay: boolean;
  shops: number;
  passwordRequired: boolean;
  authorized: boolean;
};
